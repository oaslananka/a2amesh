import { createHash, randomUUID } from 'node:crypto';
import type { ExtensibleArtifact } from '@a2amesh/protocol';
import type {
  FleetProviderWorkerPlan,
  FleetWorkerRunAdmission,
  WorkerCard,
} from '@a2amesh/internal-fleet';
import {
  AsyncEventQueue,
  type WorkerRuntimeContext,
  type WorkerRuntimeContract,
  type WorkerRuntimeEvent,
  type WorkerRuntimeFailure,
  type WorkerRuntimeResult,
  type WorkerRuntimeStopRequest,
  type WorkerRuntimeVerificationResult,
} from '@a2amesh/internal-worker-runtime';
import { assertMcpProviderPlan, validateMcpAdmission } from './policy.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 1;
const DEFAULT_MAX_OUTPUT_CHARACTERS = 100_000;
const MAX_ALLOWED_TOOLS = 64;
const MAX_TOOL_NAME_LENGTH = 128;

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpUnsupportedContent {
  type: string;
  [key: string]: unknown;
}

export interface McpToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: readonly (McpTextContent | McpUnsupportedContent)[];
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpWorkerClient {
  callTool(
    request: McpToolCallRequest,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolCallResult>;
}

export interface McpWorkerRuntimePolicy {
  allowedTools: readonly string[];
  timeoutMs?: number;
  maxConcurrentRuns?: number;
  maxOutputCharacters?: number;
}

export interface McpWorkerRuntimeConfig {
  id: string;
  card: WorkerCard;
  providerPlan: FleetProviderWorkerPlan;
  client: McpWorkerClient;
  toolName: string;
  buildArguments?: (context: WorkerRuntimeContext) => Record<string, unknown> | undefined;
  resolveAdmission: (
    context: WorkerRuntimeContext,
  ) => FleetWorkerRunAdmission | Promise<FleetWorkerRunAdmission>;
  policy: McpWorkerRuntimePolicy;
}

interface McpRunState {
  queue: AsyncEventQueue<WorkerRuntimeEvent>;
  startEvent: WorkerRuntimeEvent;
  lastEvent: WorkerRuntimeEvent;
  taskId: string;
  workerId: string;
  abortController: AbortController;
  timedOut: boolean;
  slotReleased: boolean;
  result?: WorkerRuntimeResult;
  timeoutHandle?: NodeJS.Timeout;
}

export class McpWorkerRuntimeAdapter implements WorkerRuntimeContract {
  readonly id: string;
  readonly card: WorkerCard;
  readonly providerPlan: FleetProviderWorkerPlan;

  private readonly config: McpWorkerRuntimeConfig;
  private readonly runs = new Map<string, McpRunState>();
  private activeRunCount = 0;

  constructor(config: McpWorkerRuntimeConfig) {
    validateConfig(config);
    this.id = config.id.trim();
    this.card = config.card;
    this.providerPlan = config.providerPlan;
    this.config = config;
  }

  async prepare(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const failure = await this.admissionFailure(context, 'prepare');
    return (
      failure ??
      this.buildEvent(context, {
        type: 'prepared',
        message: 'documented MCP tool admission passed',
        metadata: this.safeMetadata(),
      })
    );
  }

  async start(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const existing = this.runs.get(context.run.id);
    if (existing) {
      if (
        existing.taskId !== context.task.id ||
        existing.taskId !== context.run.taskId ||
        existing.workerId !== context.run.workerId ||
        context.worker.id !== this.id
      ) {
        return this.buildEvent(context, {
          type: 'failed',
          status: 'FAILED',
          failure: policyFailure('start', 'Run id is already bound to a different task or worker.'),
        });
      }
      return existing.startEvent;
    }

    const admissionFailure = await this.admissionFailure(context, 'start');
    if (admissionFailure) {
      return this.recordStartFailure(
        context,
        admissionFailure.failure ?? policyFailure('start', 'Fleet policy denied this MCP run.'),
      );
    }
    const capacityFailure = this.reserveRunSlot();
    if (capacityFailure) return this.recordStartFailure(context, capacityFailure);

    const abortController = new AbortController();
    const startedEvent = this.buildEvent(context, {
      type: 'started',
      status: 'RUNNING',
      message: 'MCP tool call starting',
      metadata: this.safeMetadata(),
    });
    const state = this.storeRun(context, startedEvent, {
      abortController,
      slotReleased: false,
    });

    armRunTimeout(state, abortController, this.resolveTimeoutMs(context));
    void this.execute(context, state);
    return startedEvent;
  }

  stream(context: WorkerRuntimeContext): AsyncIterable<WorkerRuntimeEvent> {
    return this.requireRun(context).queue;
  }

  async observe(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    return this.requireRun(context).lastEvent;
  }

  async verify(context: WorkerRuntimeContext): Promise<WorkerRuntimeVerificationResult> {
    const state = this.requireRun(context);
    const status = resolveVerificationStatus(state);
    const passed = status === 'PASSED';
    return {
      status,
      verifierWorkerId: this.id,
      checkedAt: new Date().toISOString(),
      summary: passed
        ? 'MCP result artifact is present and checksummed'
        : 'MCP run did not produce a verified artifact',
      ...(!passed && state.result?.failure ? { failures: [state.result.failure] } : {}),
      metadata: this.safeMetadata(),
    };
  }

  async finalize(
    context: WorkerRuntimeContext,
    result: WorkerRuntimeResult,
  ): Promise<WorkerRuntimeResult> {
    return { ...result, ...this.requireRun(context).result };
  }

  async cancel(
    context: WorkerRuntimeContext,
    request: WorkerRuntimeStopRequest,
  ): Promise<WorkerRuntimeEvent> {
    const state = this.requireRun(context);
    if (state.result) return state.lastEvent;
    state.abortController.abort(new Error('MCP tool call canceled'));
    this.clearTimeout(state);
    this.releaseRunSlot(state);
    const failure: WorkerRuntimeFailure = {
      code: 'CANCELED',
      operation: 'cancel',
      message: 'MCP tool call was canceled.',
      retryable: false,
    };
    state.result = { status: 'CANCELED', failure, metadata: this.safeMetadata() };
    const event = this.emit(context, state, {
      type: 'canceled',
      status: 'CANCELED',
      failure,
      message: request.reason ?? 'MCP tool call canceled',
      metadata: { ...this.safeMetadata(), requestedBy: request.requestedBy ?? 'operator' },
    });
    return closeRun(state, event);
  }

  async cleanup(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const state = this.runs.get(context.run.id);
    if (state) this.removeRun(context.run.id, state);
    return this.buildEvent(context, {
      type: 'cleaned-up',
      message: 'MCP run state removed',
      ...(state?.result?.status ? { status: state.result.status } : {}),
      metadata: this.safeMetadata(),
    });
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
    if (this.resolveTimeoutMs(context) <= 0) {
      return this.failureEvent(
        context,
        operation,
        'MCP run deadline has already expired.',
        'TIMEOUT',
      );
    }

    let admission: FleetWorkerRunAdmission;
    try {
      admission = await this.config.resolveAdmission(context);
    } catch {
      return this.failureEvent(context, operation, 'Fleet admission resolution failed closed.');
    }
    const denial = validateMcpAdmission(admission, context, {
      providerPlan: this.config.providerPlan,
      toolName: this.config.toolName,
      workerId: this.id,
    });
    return denial ? this.failureEvent(context, operation, denial) : undefined;
  }

  private failureEvent(
    context: WorkerRuntimeContext,
    operation: 'prepare' | 'start',
    message: string,
    code: WorkerRuntimeFailure['code'] = 'POLICY_DENIED',
  ): WorkerRuntimeEvent {
    return this.buildEvent(context, {
      type: 'failed',
      status: 'FAILED',
      message,
      failure: { code, operation, message, retryable: false },
    });
  }

  private async execute(context: WorkerRuntimeContext, state: McpRunState): Promise<void> {
    this.emit(context, state, {
      type: 'task-update',
      status: 'RUNNING',
      message: 'MCP tool call in progress',
      metadata: this.safeMetadata(),
    });
    try {
      const toolArguments = this.config.buildArguments?.(context);
      const request: McpToolCallRequest = {
        name: this.config.toolName,
        ...(toolArguments === undefined ? {} : { arguments: toolArguments }),
      };
      const result = await callWithAbort(this.config.client, request, state.abortController.signal);
      if (state.result) return;
      if (result.isError) {
        this.finishWithFailure(context, state, {
          code: 'UNKNOWN',
          operation: 'start',
          message: 'MCP tool reported a failure.',
          retryable: false,
        });
        return;
      }
      const text = result.content
        .filter(
          (part): part is McpTextContent => part.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join('\n');
      if (!text) {
        this.finishWithFailure(context, state, {
          code: 'ARTIFACT_UNAVAILABLE',
          operation: 'finalize',
          message: 'MCP tool returned no usable text output.',
          retryable: false,
        });
        return;
      }
      if (text.length > this.maxOutputCharacters()) {
        this.finishWithFailure(context, state, {
          code: 'ARTIFACT_UNAVAILABLE',
          operation: 'finalize',
          message: 'MCP tool output exceeded the configured character boundary.',
          retryable: false,
        });
        return;
      }

      const artifact = this.createArtifact(context, text);
      this.emit(context, state, { type: 'artifact', artifact });
      this.clearTimeout(state);
      this.releaseRunSlot(state);
      state.result = { status: 'COMPLETED', artifacts: [artifact], metadata: this.safeMetadata() };
      this.emit(context, state, {
        type: 'finalized',
        status: 'COMPLETED',
        message: 'MCP tool call completed',
        metadata: this.safeMetadata(),
      });
      state.queue.close();
    } catch (error) {
      if (state.result) return;
      this.finishWithFailure(
        context,
        state,
        classifyFailure(error, state),
        resolveFailureEventType(state),
      );
    }
  }

  private createArtifact(context: WorkerRuntimeContext, text: string): ExtensibleArtifact {
    return {
      artifactId: randomUUID(),
      name: `${this.config.toolName} MCP result`,
      description: 'Text result returned by a documented MCP tool.',
      parts: [{ type: 'text', text }],
      index: 0,
      lastChunk: true,
      metadata: {
        ...this.safeMetadata(),
        contentType: 'text/plain; charset=utf-8',
        checksumSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        taskId: context.task.id,
        runId: context.run.id,
      },
    };
  }

  private reserveRunSlot(): WorkerRuntimeFailure | undefined {
    if (this.activeRunCount >= this.maxConcurrentRuns()) {
      return {
        code: 'WORKER_UNAVAILABLE',
        operation: 'start',
        message: 'MCP worker concurrency limit reached.',
        retryable: true,
      };
    }
    this.activeRunCount += 1;
    return undefined;
  }

  private recordStartFailure(
    context: WorkerRuntimeContext,
    failure: WorkerRuntimeFailure,
  ): WorkerRuntimeEvent {
    const event = this.buildEvent(context, { type: 'failed', status: 'FAILED', failure });
    this.storeRun(context, event, {
      closeQueue: true,
      result: { status: 'FAILED', failure, metadata: this.safeMetadata() },
      slotReleased: true,
    });
    return event;
  }

  private storeRun(
    context: WorkerRuntimeContext,
    startEvent: WorkerRuntimeEvent,
    options: {
      abortController?: AbortController;
      closeQueue?: boolean;
      result?: WorkerRuntimeResult;
      slotReleased: boolean;
    },
  ): McpRunState {
    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    const state: McpRunState = {
      abortController: options.abortController ?? new AbortController(),
      lastEvent: startEvent,
      queue,
      slotReleased: options.slotReleased,
      startEvent,
      taskId: context.task.id,
      timedOut: false,
      workerId: context.run.workerId,
      ...(options.result ? { result: options.result } : {}),
    };
    this.runs.set(context.run.id, state);
    queue.push(startEvent);
    if (options.closeQueue) queue.close();
    return state;
  }

  private removeRun(runId: string, state: McpRunState): void {
    if (!state.result) state.abortController.abort(new Error('MCP run cleaned up'));
    this.clearTimeout(state);
    this.releaseRunSlot(state);
    state.queue.close();
    this.runs.delete(runId);
  }

  private finishWithFailure(
    context: WorkerRuntimeContext,
    state: McpRunState,
    failure: WorkerRuntimeFailure,
    eventType: 'failed' | 'canceled' = 'failed',
  ): void {
    this.clearTimeout(state);
    this.releaseRunSlot(state);
    const status = eventType === 'canceled' ? 'CANCELED' : 'FAILED';
    state.result = { status, failure, metadata: this.safeMetadata() };
    this.emit(context, state, { type: eventType, status, failure });
    state.queue.close();
  }

  private resolveTimeoutMs(context: WorkerRuntimeContext): number {
    const candidates = [
      this.config.policy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      context.timeoutMs,
      context.deadlineAt ? Date.parse(context.deadlineAt) - Date.now() : undefined,
    ].filter((value): value is number => Number.isFinite(value));
    return Math.max(0, Math.min(...candidates));
  }

  private maxConcurrentRuns(): number {
    return this.config.policy.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
  }

  private maxOutputCharacters(): number {
    return this.config.policy.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS;
  }

  private safeMetadata(): Record<string, unknown> {
    return {
      providerId: this.config.providerPlan.providerId,
      integrationSurface: 'mcp-server',
      credentialPolicy: this.config.providerPlan.credentialPolicy,
      toolName: this.config.toolName,
    };
  }

  private requireRun(context: WorkerRuntimeContext): McpRunState {
    return requireMcpRun(this.runs, context.run.id);
  }

  private buildEvent(
    context: WorkerRuntimeContext,
    partial: Partial<WorkerRuntimeEvent> & Pick<WorkerRuntimeEvent, 'type'>,
  ): WorkerRuntimeEvent {
    return createMcpEvent(this.id, context, partial);
  }

  private emit(
    context: WorkerRuntimeContext,
    state: McpRunState,
    partial: Partial<WorkerRuntimeEvent> & Pick<WorkerRuntimeEvent, 'type'>,
  ): WorkerRuntimeEvent {
    const event = this.buildEvent(context, partial);
    state.lastEvent = event;
    state.queue.push(event);
    return event;
  }

  private clearTimeout(state: McpRunState): void {
    if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
    delete state.timeoutHandle;
  }

  private releaseRunSlot(state: McpRunState): void {
    if (state.slotReleased) return;
    state.slotReleased = true;
    this.activeRunCount = Math.max(0, this.activeRunCount - 1);
  }
}

function validateConfig(config: McpWorkerRuntimeConfig): void {
  if (!config.id.trim()) throw new Error('MCP worker id must not be empty.');
  assertMcpProviderPlan(config.providerPlan);
  validateToolName(config.toolName);
  const allowedTools = config.policy.allowedTools;
  if (allowedTools.length === 0 || allowedTools.length > MAX_ALLOWED_TOOLS) {
    throw new Error(`MCP tool allowlist must contain between 1 and ${MAX_ALLOWED_TOOLS} tools.`);
  }
  if (new Set(allowedTools).size !== allowedTools.length) {
    throw new Error('MCP tool allowlist entries must be unique.');
  }
  for (const tool of allowedTools) validateToolName(tool);
  if (!allowedTools.includes(config.toolName)) {
    throw new Error('Configured MCP tool must appear in the tool allowlist.');
  }
  validatePositive(config.policy.timeoutMs, 'policy.timeoutMs');
  validatePositive(config.policy.maxConcurrentRuns, 'policy.maxConcurrentRuns');
  validatePositive(config.policy.maxOutputCharacters, 'policy.maxOutputCharacters');
}

function validateToolName(value: string): void {
  if (!value || value.length > MAX_TOOL_NAME_LENGTH) throw new Error('Invalid MCP tool name.');
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const allowed =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      character === '_' ||
      character === '-' ||
      character === '.' ||
      character === ':';
    if (!allowed) throw new Error('Invalid MCP tool name.');
  }
}

function validatePositive(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function policyFailure(operation: 'prepare' | 'start', message: string): WorkerRuntimeFailure {
  return { code: 'POLICY_DENIED', operation, message, retryable: false };
}

function armRunTimeout(
  state: McpRunState,
  abortController: AbortController,
  timeoutMs: number,
): void {
  state.timeoutHandle = setTimeout(markRunTimedOut, timeoutMs, state, abortController);
}

function markRunTimedOut(state: McpRunState, abortController: AbortController): void {
  state.timedOut = true;
  abortController.abort(new Error('MCP tool call timeout'));
}

function closeRun(state: McpRunState, event: WorkerRuntimeEvent): WorkerRuntimeEvent {
  state.queue.close();
  return event;
}

function requireMcpRun(runs: ReadonlyMap<string, McpRunState>, runId: string): McpRunState {
  const state = runs.get(runId);
  if (!state) throw new Error(`No MCP run exists for run id "${runId}".`);
  return state;
}

function createMcpEvent(
  workerId: string,
  context: WorkerRuntimeContext,
  partial: Partial<WorkerRuntimeEvent> & Pick<WorkerRuntimeEvent, 'type'>,
): WorkerRuntimeEvent {
  return Object.assign(
    {
      runId: context.run.id,
      taskId: context.task.id,
      timestamp: new Date().toISOString(),
      workerId,
    },
    partial,
  );
}

function resolveVerificationStatus(state: McpRunState): WorkerRuntimeVerificationResult['status'] {
  if (!state.result) return 'SKIPPED';
  const hasChecksummedArtifact = state.result.artifacts?.some(
    (artifact) => typeof artifact.metadata?.['checksumSha256'] === 'string',
  );
  return state.result.status === 'COMPLETED' && hasChecksummedArtifact ? 'PASSED' : 'FAILED';
}

function resolveFailureEventType(state: McpRunState): 'failed' | 'canceled' {
  return state.abortController.signal.aborted && !state.timedOut ? 'canceled' : 'failed';
}

function classifyFailure(_error: unknown, state: McpRunState): WorkerRuntimeFailure {
  if (state.abortController.signal.aborted) {
    return state.timedOut
      ? {
          code: 'TIMEOUT',
          operation: 'start',
          message: 'MCP tool call exceeded the configured timeout.',
          retryable: true,
        }
      : {
          code: 'CANCELED',
          operation: 'cancel',
          message: 'MCP tool call was canceled.',
          retryable: false,
        };
  }
  return {
    code: 'UNKNOWN',
    operation: 'start',
    message: 'MCP tool call failed.',
    retryable: false,
  };
}

async function callWithAbort(
  client: McpWorkerClient,
  request: McpToolCallRequest,
  signal: AbortSignal,
): Promise<McpToolCallResult> {
  if (signal.aborted) throw signal.reason;
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort?.(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([client.callTool(request, { signal }), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
