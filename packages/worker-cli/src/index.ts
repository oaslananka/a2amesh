import { isAbsolute } from 'node:path';
import type {
  FleetProviderWorkerPlan,
  FleetUnsupportedProviderSurface,
  FleetWorkerRunAdmission,
  WorkerCard,
} from '@a2amesh/internal-fleet';
import {
  LocalCliWorkerRuntimeAdapter,
  type LocalCliWorkerRuntimePolicy,
  type WorkerRuntimeContext,
  type WorkerRuntimeContract,
  type WorkerRuntimeEvent,
  type WorkerRuntimeResult,
  type WorkerRuntimeStopRequest,
  type WorkerRuntimeVerificationResult,
} from '@a2amesh/internal-worker-runtime';

const FORBIDDEN_SURFACES = [
  'browser-session',
  'web-ui-scraping',
  'private-endpoint',
  'token-extraction',
  'subscription-bypass',
] as const satisfies readonly FleetUnsupportedProviderSurface[];

const ENVIRONMENT_REFERENCE = /^[A-Z_][A-Z0-9_]*$/u;
const MAX_ENVIRONMENT_REFERENCES = 32;

type AdmissionResolver = (
  context: WorkerRuntimeContext,
) => FleetWorkerRunAdmission | Promise<FleetWorkerRunAdmission>;

export type OfficialCliWorkerRuntimePolicy = Omit<LocalCliWorkerRuntimePolicy, 'envAllowlist'>;

export interface OfficialCliWorkerRuntimeConfig {
  id: string;
  card: WorkerCard;
  providerPlan: FleetProviderWorkerPlan;
  /** Absolute vendor CLI executable path. Ambient PATH lookup is forbidden. */
  command: string;
  /** Fixed arguments prepended to every invocation. */
  baseArgs?: readonly string[];
  /** Builds task-specific CLI arguments. */
  buildArgs?: (context: WorkerRuntimeContext) => readonly string[];
  /** Working directory relative to the policy workspace root. */
  cwd?: string;
  /** Names only. Values are read from the host environment by the confined runtime. */
  environmentReferences?: readonly string[];
  /** Declared artifact paths relative to the canonical working directory. */
  artifactFiles?: (context: WorkerRuntimeContext) => readonly string[];
  /** Resolves the task/worker/command-bound Fleet policy decision for each admission. */
  resolveAdmission: AdmissionResolver;
  policy: OfficialCliWorkerRuntimePolicy;
}

/**
 * Policy-backed official CLI worker.
 *
 * Process execution, path confinement, output redaction, timeouts, cancellation,
 * concurrency, and artifact capture remain delegated to LocalCliWorkerRuntimeAdapter.
 * This layer validates the documented provider surface and a per-run Fleet admission.
 */
export class OfficialCliWorkerRuntimeAdapter implements WorkerRuntimeContract {
  readonly id: string;
  readonly card: WorkerCard;
  readonly providerPlan: FleetProviderWorkerPlan;

  private readonly config: OfficialCliWorkerRuntimeConfig;
  private readonly delegate: LocalCliWorkerRuntimeAdapter;

  constructor(config: OfficialCliWorkerRuntimeConfig) {
    validateConfig(config);
    this.id = config.id;
    this.card = config.card;
    this.providerPlan = config.providerPlan;
    this.config = config;
    this.delegate = new LocalCliWorkerRuntimeAdapter({
      id: config.id,
      card: config.card,
      command: config.command,
      ...(config.baseArgs ? { baseArgs: config.baseArgs } : {}),
      ...(config.buildArgs ? { buildArgs: config.buildArgs } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      ...(config.artifactFiles ? { artifactFiles: config.artifactFiles } : {}),
      policy: {
        ...config.policy,
        envAllowlist: config.environmentReferences ?? [],
      },
    });
  }

  async prepare(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const failure = await this.admissionFailure(context, 'prepare');
    return failure ?? this.delegate.prepare(context);
  }

  async start(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const failure = await this.admissionFailure(context, 'start');
    return failure ?? this.delegate.start(context);
  }

  stream(context: WorkerRuntimeContext): AsyncIterable<WorkerRuntimeEvent> {
    return this.delegate.stream(context);
  }

  observe(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    return this.delegate.observe(context);
  }

  verify(context: WorkerRuntimeContext): Promise<WorkerRuntimeVerificationResult> {
    return this.delegate.verify(context);
  }

  finalize(
    context: WorkerRuntimeContext,
    result: WorkerRuntimeResult,
  ): Promise<WorkerRuntimeResult> {
    return this.delegate.finalize(context, result);
  }

  cancel(
    context: WorkerRuntimeContext,
    request: WorkerRuntimeStopRequest,
  ): Promise<WorkerRuntimeEvent> {
    return this.delegate.cancel(context, request);
  }

  cleanup(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    return this.delegate.cleanup(context);
  }

  private async admissionFailure(
    context: WorkerRuntimeContext,
    operation: 'prepare' | 'start',
  ): Promise<WorkerRuntimeEvent | undefined> {
    if (
      context.worker.id !== this.id ||
      context.run.workerId !== this.id ||
      context.run.taskId !== context.task.id
    ) {
      return this.failureEvent(
        context,
        operation,
        'Worker identity and task binding must match the admitted run.',
      );
    }

    let admission: FleetWorkerRunAdmission;
    try {
      admission = await this.config.resolveAdmission(context);
    } catch {
      return this.failureEvent(context, operation, 'Fleet admission resolution failed closed.');
    }

    const denial = validateAdmission(admission, context, this.config);
    return denial ? this.failureEvent(context, operation, denial) : undefined;
  }

  private failureEvent(
    context: WorkerRuntimeContext,
    operation: 'prepare' | 'start',
    message: string,
  ): WorkerRuntimeEvent {
    return {
      type: 'failed',
      runId: context.run.id,
      workerId: this.id,
      taskId: context.task.id,
      timestamp: new Date().toISOString(),
      status: 'FAILED',
      message,
      failure: { code: 'POLICY_DENIED', operation, message, retryable: false },
    };
  }
}

function validateConfig(config: OfficialCliWorkerRuntimeConfig): void {
  if (!config.id.trim()) throw new Error('Official CLI worker id must not be empty.');
  if (!isAbsolute(config.command)) {
    throw new Error('Official CLI worker command must be an absolute executable path.');
  }
  if (!config.policy.commandAllowlist.includes(config.command)) {
    throw new Error('Official CLI command must appear in the executable allowlist.');
  }
  if (!config.providerPlan.allowedSurfaces.includes('official-cli')) {
    throw new Error('Provider plan must allow the official-cli surface.');
  }
  if (!config.providerPlan.allowedSurfaces.includes('artifact-handoff')) {
    throw new Error('Provider plan must allow the artifact-handoff surface.');
  }
  if (
    config.providerPlan.supportStatus === 'manual-only' ||
    config.providerPlan.supportStatus === 'unsupported'
  ) {
    throw new Error('Official CLI worker requires a supported or experimental provider plan.');
  }
  for (const surface of FORBIDDEN_SURFACES) {
    if (!config.providerPlan.forbiddenSurfaces.includes(surface)) {
      throw new Error(`Provider plan must keep ${surface} forbidden.`);
    }
  }
  if (
    config.providerPlan.credentialPolicy !== 'official-cli-session' &&
    config.providerPlan.credentialPolicy !== 'env-ref'
  ) {
    throw new Error('Official CLI worker credentials must use official-cli-session or env-ref.');
  }

  const environmentReferences = config.environmentReferences ?? [];
  if (environmentReferences.length > MAX_ENVIRONMENT_REFERENCES) {
    throw new Error(`Official CLI worker accepts at most ${MAX_ENVIRONMENT_REFERENCES} env refs.`);
  }
  if (new Set(environmentReferences).size !== environmentReferences.length) {
    throw new Error('Official CLI environment references must be unique.');
  }
  for (const name of environmentReferences) {
    if (!ENVIRONMENT_REFERENCE.test(name)) {
      throw new Error(`Invalid official CLI environment reference: ${name}`);
    }
  }
  if (
    config.providerPlan.credentialPolicy === 'official-cli-session' &&
    environmentReferences.length > 0
  ) {
    throw new Error('official-cli-session plans must not forward environment references.');
  }
}

function validateAdmission(
  admission: FleetWorkerRunAdmission,
  context: WorkerRuntimeContext,
  config: OfficialCliWorkerRuntimeConfig,
): string | undefined {
  if (admission.taskId !== context.task.id) return 'Fleet admission is bound to a different task.';
  if (admission.workerId !== config.id) return 'Fleet admission is bound to a different worker.';
  if (!admission.decision.allowed) {
    return admission.decision.denialReason?.trim() || 'Fleet policy denied this CLI run.';
  }

  const level = admission.decision.sideEffectLevel;
  if (level !== 'read-only' && level !== 'local-write') {
    return `Official CLI worker denies ${level} side effects.`;
  }
  if (level === 'local-write' && !config.providerPlan.allowedSurfaces.includes('git-worktree')) {
    return 'Local repository mutation requires the git-worktree provider surface.';
  }

  const sandbox = admission.decision.sandbox;
  if (sandbox.isolation === 'none')
    return 'Official CLI worker requires process isolation or stronger.';
  if (!sandbox.allowedCommands?.includes(config.command)) {
    return 'Fleet admission must bind the absolute official CLI command.';
  }
  if (sandbox.blockedCommands?.includes(config.command)) {
    return 'Fleet admission blocks the configured official CLI command.';
  }
  if (level === 'read-only' && sandbox.filesystem === 'workspace-write') {
    return 'Read-only CLI admission must use read-only or ephemeral filesystem policy.';
  }
  if (level === 'local-write' && sandbox.filesystem !== 'workspace-write') {
    return 'Local-write CLI admission requires workspace-write filesystem policy.';
  }

  const boundary = admission.boundaries.find((candidate) => candidate.level === level);
  if (!boundary) return `Fleet admission is missing the ${level} side-effect boundary.`;
  if (!boundary.requiresAudit) return `Fleet admission must audit ${level} CLI work.`;
  if (boundary.permittedCommands && !boundary.permittedCommands.includes(config.command)) {
    return 'Fleet side-effect boundary does not permit the configured CLI command.';
  }

  const approval = admission.decision.approval;
  if (level === 'local-write') {
    if (!boundary.requiresApproval || !approval.requiredFor.includes('local-write')) {
      return 'Local repository mutation must be marked as approval-required.';
    }
    if (approval.state !== 'APPROVED' || !approval.approver?.trim()) {
      return 'Local repository mutation requires explicit maintainer approval.';
    }
  } else if (approval.requiredFor.includes('read-only') && approval.state !== 'APPROVED') {
    return 'Read-only admission is approval-gated but not approved.';
  }

  if (approval.expiresAt) {
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return 'Fleet approval is invalid or expired.';
    }
  }
  if (!admission.decision.artifactPolicy.requireChecksum) {
    return 'Official CLI artifacts must require checksums.';
  }
  if (!admission.decision.artifactPolicy.requireRedaction) {
    return 'Official CLI artifacts must require redaction.';
  }

  const requestedLevel = context.metadata?.['sideEffectLevel'];
  if (requestedLevel !== undefined && requestedLevel !== level) {
    return 'Requested side-effect level does not match Fleet admission.';
  }
  return undefined;
}
