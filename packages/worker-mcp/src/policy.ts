import type {
  FleetProviderWorkerPlan,
  FleetUnsupportedProviderSurface,
  FleetWorkerRunAdmission,
} from '@a2amesh/internal-fleet';
import type { WorkerRuntimeContext } from '@a2amesh/internal-worker-runtime';

const REQUIRED_SURFACES = ['mcp-server', 'artifact-handoff'] as const;
const SUPPORTED_STATUSES = new Set<FleetProviderWorkerPlan['supportStatus']>([
  'supported',
  'experimental',
]);
const CREDENTIAL_POLICIES = new Set<FleetProviderWorkerPlan['credentialPolicy']>([
  'env-ref',
  'secret-manager-ref',
  'none',
]);
const FORBIDDEN_SURFACES = [
  'browser-session',
  'web-ui-scraping',
  'private-endpoint',
  'token-extraction',
  'subscription-bypass',
] as const satisfies readonly FleetUnsupportedProviderSurface[];

type SideEffectLevel = FleetWorkerRunAdmission['decision']['sideEffectLevel'];
type AdmissionBoundary = FleetWorkerRunAdmission['boundaries'][number];

interface AdmissionValidationInput {
  admission: FleetWorkerRunAdmission;
  context: WorkerRuntimeContext;
  providerPlan: FleetProviderWorkerPlan;
  toolName: string;
  workerId: string;
}

type AdmissionValidator = (input: AdmissionValidationInput) => string | undefined;

const ADMISSION_VALIDATORS: readonly AdmissionValidator[] = [
  validateBinding,
  validateDecision,
  validateRequestedMetadata,
  validateSandbox,
  validateBoundary,
  validateApproval,
  validateArtifactPolicy,
];

export function assertMcpProviderPlan(providerPlan: FleetProviderWorkerPlan): void {
  const missingRequiredSurface = REQUIRED_SURFACES.find(
    (surface) => !providerPlan.allowedSurfaces.includes(surface),
  );
  if (missingRequiredSurface) {
    throw new Error(`Provider plan must allow the ${missingRequiredSurface} surface.`);
  }

  if (!SUPPORTED_STATUSES.has(providerPlan.supportStatus)) {
    throw new Error('MCP worker requires a supported or experimental provider plan.');
  }

  const unblockedSurface = FORBIDDEN_SURFACES.find(
    (surface) => !providerPlan.forbiddenSurfaces.includes(surface),
  );
  if (unblockedSurface) {
    throw new Error(`Provider plan must keep ${unblockedSurface} forbidden.`);
  }

  if (!CREDENTIAL_POLICIES.has(providerPlan.credentialPolicy)) {
    throw new Error('MCP worker credential policy must use env-ref, secret-manager-ref, or none.');
  }
}

export function validateMcpAdmission(
  admission: FleetWorkerRunAdmission,
  context: WorkerRuntimeContext,
  options: {
    providerPlan: FleetProviderWorkerPlan;
    toolName: string;
    workerId: string;
  },
): string | undefined {
  const input: AdmissionValidationInput = { admission, context, ...options };
  for (const validate of ADMISSION_VALIDATORS) {
    const denial = validate(input);
    if (denial) return denial;
  }
  return undefined;
}

function validateBinding({
  admission,
  context,
  workerId,
}: AdmissionValidationInput): string | undefined {
  if (admission.taskId !== context.task.id) return 'Fleet admission is bound to a different task.';
  if (admission.workerId !== workerId) return 'Fleet admission is bound to a different worker.';
  return undefined;
}

function validateDecision({
  admission,
  providerPlan,
}: AdmissionValidationInput): string | undefined {
  const { decision } = admission;
  if (!decision.allowed) {
    return decision.denialReason?.trim() || 'Fleet policy denied this MCP run.';
  }
  const level = decision.sideEffectLevel;
  if (!isSupportedLevel(level)) return `MCP worker denies ${level} side effects.`;
  if (level === 'local-write' && !providerPlan.allowedSurfaces.includes('git-worktree')) {
    return 'Local repository mutation requires the git-worktree provider surface.';
  }
  return undefined;
}

function validateRequestedMetadata({
  admission,
  context,
  toolName,
}: AdmissionValidationInput): string | undefined {
  const requestedLevel = context.metadata?.['sideEffectLevel'];
  if (requestedLevel !== undefined && requestedLevel !== admission.decision.sideEffectLevel) {
    return 'Requested side-effect level does not match Fleet admission.';
  }
  const requestedTool = context.metadata?.['mcpToolName'];
  if (requestedTool !== undefined && requestedTool !== toolName) {
    return 'Requested MCP tool does not match the configured allowlisted tool.';
  }
  return undefined;
}

function validateSandbox({ admission }: AdmissionValidationInput): string | undefined {
  const { sandbox, sideEffectLevel: level } = admission.decision;
  if (sandbox.isolation === 'none') return 'MCP worker requires process isolation or stronger.';
  if (level === 'read-only' && sandbox.filesystem === 'workspace-write') {
    return 'Read-only MCP admission must use read-only or ephemeral filesystem policy.';
  }
  if (level === 'local-write' && sandbox.filesystem !== 'workspace-write') {
    return 'Local-write MCP admission requires workspace-write filesystem policy.';
  }
  return undefined;
}

function validateBoundary({ admission }: AdmissionValidationInput): string | undefined {
  const level = admission.decision.sideEffectLevel;
  const boundary = findBoundary(admission, level);
  if (!boundary) return `Fleet admission is missing the ${level} side-effect boundary.`;
  return boundary.requiresAudit ? undefined : `Fleet admission must audit ${level} MCP work.`;
}

function validateApproval({ admission }: AdmissionValidationInput): string | undefined {
  const { approval, sideEffectLevel: level } = admission.decision;
  const boundary = findBoundary(admission, level);
  if (level === 'local-write') return validateWriteApproval(boundary, approval);
  if (approval.requiredFor.includes('read-only') && approval.state !== 'APPROVED') {
    return 'Read-only admission is approval-gated but not approved.';
  }
  return validateApprovalExpiry(approval.expiresAt);
}

function validateWriteApproval(
  boundary: AdmissionBoundary | undefined,
  approval: FleetWorkerRunAdmission['decision']['approval'],
): string | undefined {
  if (!boundary?.requiresApproval || !approval.requiredFor.includes('local-write')) {
    return 'Local repository mutation must be marked as approval-required.';
  }
  if (approval.state !== 'APPROVED' || !approval.approver?.trim()) {
    return 'Local repository mutation requires explicit maintainer approval.';
  }
  return validateApprovalExpiry(approval.expiresAt);
}

function validateApprovalExpiry(expiresAt: string | undefined): string | undefined {
  if (!expiresAt) return undefined;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp > Date.now()
    ? undefined
    : 'Fleet approval is invalid or expired.';
}

function validateArtifactPolicy({ admission }: AdmissionValidationInput): string | undefined {
  const policy = admission.decision.artifactPolicy;
  if (!policy.requireChecksum) return 'MCP artifacts must require checksums.';
  return policy.requireRedaction ? undefined : 'MCP artifacts must require redaction.';
}

function findBoundary(
  admission: FleetWorkerRunAdmission,
  level: SideEffectLevel,
): AdmissionBoundary | undefined {
  return admission.boundaries.find((candidate) => candidate.level === level);
}

function isSupportedLevel(level: SideEffectLevel): level is 'read-only' | 'local-write' {
  return level === 'read-only' || level === 'local-write';
}
