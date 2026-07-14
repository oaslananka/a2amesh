import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ExtensibleArtifact } from '@a2amesh/protocol';
import type { WorkerCard } from '@a2amesh/internal-fleet';
import {
  PathConfinementError,
  readConfinedRegularFile,
  resolveWorkerExecution,
  type ResolvedWorkerExecution,
} from '../security/pathConfinement.js';
import { collectSensitiveEnvironmentValues, redactSensitiveText } from '../security/redaction.js';
import { AsyncEventQueue } from '../util/AsyncEventQueue.js';
import type {
  WorkerRuntimeContext,
  WorkerRuntimeContract,
  WorkerRuntimeEvent,
  WorkerRuntimeFailure,
  WorkerRuntimeResult,
  WorkerRuntimeStopRequest,
  WorkerRuntimeVerificationResult,
} from '../types/lifecycle.js';

export interface LocalCliWorkerRuntimePolicy {
  /** Absolute, canonical executable paths permitted to run. Ambient PATH lookup is disabled. */
  commandAllowlist: readonly string[];
  /** Names of environment variables that may be forwarded from the host process. Empty by default. */
  envAllowlist?: readonly string[];
  /** Absolute path all canonical working directories and artifacts must stay within. */
  workspaceRoot: string;
  /** Milliseconds before an in-flight run is aborted. Defaults to 120000. */
  timeoutMs?: number;
  /** Caps combined stdout+stderr bytes captured per run. Defaults to 1MB. */
  maxOutputBytes?: number;
  /** Caps concurrently running processes for this adapter instance. Defaults to 1. */
  maxConcurrentRuns?: number;
  /** Maximum declared artifact paths per run. Defaults to 16. */
  maxArtifactFiles?: number;
  /** Maximum bytes read from one artifact. Defaults to 5MB. */
  maxArtifactBytes?: number;
  /** Maximum aggregate artifact bytes per run. Defaults to 20MB. */
  maxTotalArtifactBytes?: number;
  /** Allowed artifact filename extensions. Defaults to a conservative text/report allowlist. */
  allowedArtifactExtensions?: readonly string[];
  /** Permit non-UTF-8/binary artifact content. Disabled by default. */
  allowBinaryArtifacts?: boolean;
}

export interface LocalCliWorkerRuntimeConfig {
  id: string;
  card: WorkerCard;
  /** Absolute executable path. Its canonical path must appear in `policy.commandAllowlist`. */
  command: string;
  /** Fixed arguments prepended to every invocation. */
  baseArgs?: readonly string[];
  /** Builds task-specific CLI arguments. Defaults to `[context.task.description ?? context.task.id]`. */
  buildArgs?: (context: WorkerRuntimeContext) => readonly string[];
  /** Working directory, resolved relative to `policy.workspaceRoot`. Defaults to the workspace root itself. */
  cwd?: string;
  /** Explicit environment values merged in after allowlist filtering. Never sourced from secrets by default. */
  env?: Readonly<Record<string, string>>;
  /** Declares output files (relative to the canonical cwd) to capture as artifacts once the run completes. */
  artifactFiles?: (context: WorkerRuntimeContext) => readonly string[];
  policy: LocalCliWorkerRuntimePolicy;
}

interface CliRunState {
  queue: AsyncEventQueue<WorkerRuntimeEvent>;
  lastEvent: WorkerRuntimeEvent;
  result?: WorkerRuntimeResult;
  abortController: AbortController;
  timeoutHandle?: NodeJS.Timeout;
  slotReleased: boolean;
}

interface OutputStreamState {
  decoder: StringDecoder;
  pending: string;
  truncated: boolean;
}

interface OutputCaptureState {
  outputBytes: number;
  stdout: OutputStreamState;
  stderr: OutputStreamState;
}

type PolicyEvaluation =
  | { allowed: true; execution: ResolvedWorkerExecution }
  | { allowed: false; failure: WorkerRuntimeFailure };

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_MAX_CONCURRENT_RUNS = 1;
const DEFAULT_MAX_ARTIFACT_FILES = 16;
const DEFAULT_MAX_ARTIFACT_BYTES = 5 * 1_048_576;
const DEFAULT_MAX_TOTAL_ARTIFACT_BYTES = 20 * 1_048_576;
const DEFAULT_ARTIFACT_EXTENSIONS = [
  '.csv',
  '.css',
  '.diff',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.log',
  '.md',
  '.patch',
  '.toml',
  '.ts',
  '.tsv',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
] as const;

/**
 * Generic local CLI agent adapter (#90). Wraps an explicitly allowlisted
 * executable in a canonical workspace with no secret passthrough by default,
 * structured failures, timeouts, cancellation, and confined artifact capture.
 */
export class LocalCliWorkerRuntimeAdapter implements WorkerRuntimeContract {
  readonly id: string;
  readonly card: WorkerCard;
  private readonly config: LocalCliWorkerRuntimeConfig;
  private readonly runs = new Map<string, CliRunState>();
  private activeRunCount = 0;

  constructor(config: LocalCliWorkerRuntimeConfig) {
    this.id = config.id;
    this.card = config.card;
    this.config = config;
  }

  async prepare(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const evaluation = await this.evaluatePolicy(context);
    if (!evaluation.allowed) {
      return this.buildEvent(context, { type: 'failed', failure: evaluation.failure });
    }
    return this.buildEvent(context, { type: 'prepared', message: 'policy checks passed' });
  }

  async start(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const reservationFailure = this.reserveRunSlot();
    if (reservationFailure) return this.recordStartFailure(context, reservationFailure);

    const evaluation = await this.evaluateExecutionPolicy(context);
    if (!evaluation.allowed) {
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
      return this.recordStartFailure(context, evaluation.failure);
    }

    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    const abortController = new AbortController();
    const startedEvent = this.buildEvent(context, { type: 'started', message: 'process starting' });
    const state: CliRunState = {
      queue,
      lastEvent: startedEvent,
      abortController,
      slotReleased: false,
    };
    this.runs.set(context.run.id, state);
    queue.push(startedEvent);

    const timeoutMs = this.config.policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    state.timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`local CLI run exceeded ${timeoutMs}ms timeout`));
    }, timeoutMs);

    void this.run(context, state, evaluation.execution);
    return startedEvent;
  }

  private async run(
    context: WorkerRuntimeContext,
    state: CliRunState,
    execution: ResolvedWorkerExecution,
  ): Promise<void> {
    const args = [...(this.config.baseArgs ?? []), ...this.buildTaskArgs(context)];
    const maxOutputBytes = this.config.policy.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const env = this.buildEnv();
    const sensitiveValues = collectSensitiveEnvironmentValues(env);
    const output: OutputCaptureState = {
      outputBytes: 0,
      stdout: { decoder: new StringDecoder('utf8'), pending: '', truncated: false },
      stderr: { decoder: new StringDecoder('utf8'), pending: '', truncated: false },
    };

    const appendOutput = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      const streamState = output[stream];
      const remaining = maxOutputBytes - output.outputBytes;
      if (remaining <= 0) {
        streamState.truncated = true;
        return;
      }
      const accepted = chunk.subarray(0, remaining);
      if (accepted.byteLength < chunk.byteLength) streamState.truncated = true;
      output.outputBytes += accepted.byteLength;
      streamState.pending += streamState.decoder.write(accepted);
      this.emitCompleteOutputLines(context, state, stream, streamState, sensitiveValues);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(execution.executable, args, {
        cwd: execution.cwd,
        env,
        shell: false,
        signal: state.abortController.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      this.releaseRunSlot(state);
      this.finishWithFailure(context, state, {
        code: 'UNKNOWN',
        message: redactSensitiveText(
          error instanceof Error ? error.message : 'failed to spawn local CLI process',
          sensitiveValues,
        ),
      });
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => appendOutput(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => appendOutput(chunk, 'stderr'));

    let outputFlushed = false;
    const flushOutput = (): void => {
      if (outputFlushed) return;
      outputFlushed = true;
      for (const stream of ['stdout', 'stderr'] as const) {
        const streamState = output[stream];
        streamState.pending += streamState.decoder.end();
        this.emitCompleteOutputLines(context, state, stream, streamState, sensitiveValues, true);
      }
    };

    const finishAbort = (): void => {
      flushOutput();
      this.clearRunTimeout(state);
      this.releaseRunSlot(state);
      if (state.result) return;
      const reason = state.abortController.signal.reason;
      const timedOut = reason instanceof Error && reason.message.includes('timeout');
      this.finishWithFailure(
        context,
        state,
        {
          code: timedOut ? 'TIMEOUT' : 'CANCELED',
          message: redactSensitiveText(
            reason instanceof Error ? reason.message : 'run aborted',
            sensitiveValues,
          ),
          retryable: timedOut,
        },
        timedOut ? 'failed' : 'canceled',
      );
    };

    child.once('error', (error) => {
      if (state.abortController.signal.aborted) {
        finishAbort();
        return;
      }
      flushOutput();
      this.clearRunTimeout(state);
      this.releaseRunSlot(state);
      if (state.result) return;
      this.finishWithFailure(context, state, {
        code: 'UNKNOWN',
        message: redactSensitiveText(error.message, sensitiveValues),
      });
    });

    child.once('close', (exitCode, signal) => {
      if (state.abortController.signal.aborted) {
        finishAbort();
        return;
      }
      flushOutput();
      this.clearRunTimeout(state);
      this.releaseRunSlot(state);
      if (state.result) return;

      if (exitCode !== 0) {
        this.finishWithFailure(context, state, {
          code: 'UNKNOWN',
          message: `command exited with code ${exitCode ?? 'null'}${signal ? ` (signal ${signal})` : ''}`,
        });
        return;
      }

      void this.completeSuccessfulRun(context, state, execution.cwd, sensitiveValues);
    });
  }

  private async completeSuccessfulRun(
    context: WorkerRuntimeContext,
    state: CliRunState,
    cwd: string,
    sensitiveValues: readonly string[],
  ): Promise<void> {
    try {
      const artifacts = await this.captureArtifacts(context, cwd, sensitiveValues);
      state.lastEvent = this.emit(context, { type: 'finalized', message: 'completed' }, state);
      state.result = { status: 'COMPLETED', artifacts };
      state.queue.close();
    } catch (error) {
      this.finishWithFailure(context, state, {
        code: 'ARTIFACT_UNAVAILABLE',
        operation: 'finalize',
        message: redactSensitiveText(
          error instanceof Error ? error.message : 'artifact capture failed closed',
          sensitiveValues,
        ),
      });
    }
  }

  private emitCompleteOutputLines(
    context: WorkerRuntimeContext,
    state: CliRunState,
    stream: 'stdout' | 'stderr',
    streamState: OutputStreamState,
    sensitiveValues: readonly string[],
    flush = false,
  ): void {
    const lines = streamState.pending.split(/\r?\n/);
    const tail = lines.pop() ?? '';
    for (const line of lines) {
      this.emitOutputLine(context, state, stream, line, sensitiveValues);
    }
    if (flush) {
      if (streamState.truncated) {
        this.emitOutputLine(context, state, stream, '[output truncated]', []);
      } else {
        this.emitOutputLine(context, state, stream, tail, sensitiveValues);
      }
      streamState.pending = '';
    } else {
      streamState.pending = tail;
    }
  }

  private emitOutputLine(
    context: WorkerRuntimeContext,
    state: CliRunState,
    stream: 'stdout' | 'stderr',
    line: string,
    sensitiveValues: readonly string[],
  ): void {
    if (line.length === 0) return;
    state.lastEvent = this.emit(
      context,
      {
        type: 'task-update',
        message: `[${stream}] ${redactSensitiveText(line, sensitiveValues)}`,
      },
      state,
    );
  }

  private finishWithFailure(
    context: WorkerRuntimeContext,
    state: CliRunState,
    failure: WorkerRuntimeFailure,
    eventType: 'failed' | 'canceled' = 'failed',
  ): void {
    if (state.result) return;
    this.clearRunTimeout(state);
    state.lastEvent = this.emit(
      context,
      { type: eventType, failure, message: failure.message },
      state,
    );
    state.result = { status: eventType === 'canceled' ? 'CANCELED' : 'FAILED', failure };
    state.queue.close();
  }

  stream(context: WorkerRuntimeContext): AsyncIterable<WorkerRuntimeEvent> {
    return this.requireRun(context).queue;
  }

  async observe(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    return this.requireRun(context).lastEvent;
  }

  async verify(context: WorkerRuntimeContext): Promise<WorkerRuntimeVerificationResult> {
    const state = this.requireRun(context);
    const status = state.result?.status;
    return {
      status: status === 'COMPLETED' ? 'PASSED' : status === undefined ? 'SKIPPED' : 'FAILED',
      verifierWorkerId: this.id,
      checkedAt: new Date().toISOString(),
      ...(state.result?.failure ? { failures: [state.result.failure] } : {}),
    };
  }

  async finalize(
    context: WorkerRuntimeContext,
    result: WorkerRuntimeResult,
  ): Promise<WorkerRuntimeResult> {
    const state = this.requireRun(context);
    return { ...result, ...state.result };
  }

  async cancel(
    context: WorkerRuntimeContext,
    request: WorkerRuntimeStopRequest,
  ): Promise<WorkerRuntimeEvent> {
    const state = this.requireRun(context);
    if (!state.result) {
      state.abortController.abort(new Error(request.reason ?? 'canceled by operator'));
    }
    return state.lastEvent;
  }

  async cleanup(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const state = this.runs.get(context.run.id);
    this.runs.delete(context.run.id);
    return this.buildEvent(context, {
      type: 'cleaned-up',
      message: 'cleaned up',
      ...(state?.result?.status ? { status: state.result.status } : {}),
    });
  }

  private async evaluatePolicy(context: WorkerRuntimeContext): Promise<PolicyEvaluation> {
    const limitFailure = this.validatePolicyLimits();
    if (limitFailure) return { allowed: false, failure: limitFailure };

    const concurrencyFailure = this.concurrencyFailure();
    if (concurrencyFailure) return { allowed: false, failure: concurrencyFailure };
    return this.evaluateExecutionPolicy(context);
  }

  private async evaluateExecutionPolicy(context: WorkerRuntimeContext): Promise<PolicyEvaluation> {
    try {
      const execution = await resolveWorkerExecution(
        this.config.policy.workspaceRoot,
        this.config.cwd,
        this.config.command,
        this.config.policy.commandAllowlist,
      );
      void context;
      return { allowed: true, execution };
    } catch (error) {
      return {
        allowed: false,
        failure: {
          code: 'POLICY_DENIED',
          message:
            error instanceof Error ? error.message : 'local CLI path confinement check failed',
          operation: 'prepare',
        },
      };
    }
  }

  private reserveRunSlot(): WorkerRuntimeFailure | undefined {
    const limitFailure = this.validatePolicyLimits();
    if (limitFailure) return limitFailure;
    const concurrencyFailure = this.concurrencyFailure();
    if (concurrencyFailure) return concurrencyFailure;
    this.activeRunCount += 1;
    return undefined;
  }

  private concurrencyFailure(): WorkerRuntimeFailure | undefined {
    const maxConcurrentRuns = this.config.policy.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
    if (this.activeRunCount < maxConcurrentRuns) return undefined;
    return {
      code: 'POLICY_DENIED',
      message: `local CLI adapter "${this.id}" is at its concurrency limit (${maxConcurrentRuns})`,
      operation: 'prepare',
      retryable: true,
    };
  }

  private recordStartFailure(
    context: WorkerRuntimeContext,
    failure: WorkerRuntimeFailure,
  ): WorkerRuntimeEvent {
    const event = this.buildEvent(context, { type: 'failed', failure });
    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    queue.push(event);
    queue.close();
    this.runs.set(context.run.id, {
      queue,
      lastEvent: event,
      result: { status: 'FAILED', failure },
      abortController: new AbortController(),
      slotReleased: true,
    });
    return event;
  }

  private validatePolicyLimits(): WorkerRuntimeFailure | undefined {
    const values: readonly [string, number][] = [
      ['timeoutMs', this.config.policy.timeoutMs ?? DEFAULT_TIMEOUT_MS],
      ['maxOutputBytes', this.config.policy.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES],
      ['maxConcurrentRuns', this.config.policy.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS],
      ['maxArtifactFiles', this.config.policy.maxArtifactFiles ?? DEFAULT_MAX_ARTIFACT_FILES],
      ['maxArtifactBytes', this.config.policy.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES],
      [
        'maxTotalArtifactBytes',
        this.config.policy.maxTotalArtifactBytes ?? DEFAULT_MAX_TOTAL_ARTIFACT_BYTES,
      ],
    ];
    const invalid = values.find(([, value]) => !Number.isSafeInteger(value) || value <= 0);
    if (!invalid) return undefined;
    return {
      code: 'POLICY_DENIED',
      operation: 'prepare',
      message: `local CLI policy ${invalid[0]} must be a positive safe integer`,
    };
  }

  private buildTaskArgs(context: WorkerRuntimeContext): readonly string[] {
    if (this.config.buildArgs) return this.config.buildArgs(context);
    return [context.task.description ?? context.task.id];
  }

  private buildEnv(): Record<string, string> {
    const allowlist = new Set(this.config.policy.envAllowlist ?? []);
    const forwarded: Record<string, string> = {};
    for (const name of allowlist) {
      const value = process.env[name];
      if (value !== undefined) forwarded[name] = value;
    }
    return { ...forwarded, ...(this.config.env ?? {}) };
  }

  private async captureArtifacts(
    context: WorkerRuntimeContext,
    cwd: string,
    sensitiveValues: readonly string[],
  ): Promise<ExtensibleArtifact[]> {
    const declared = this.config.artifactFiles?.(context) ?? [];
    const maxFiles = this.config.policy.maxArtifactFiles ?? DEFAULT_MAX_ARTIFACT_FILES;
    const maxArtifactBytes = this.config.policy.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    const maxTotalBytes =
      this.config.policy.maxTotalArtifactBytes ?? DEFAULT_MAX_TOTAL_ARTIFACT_BYTES;
    const allowedExtensions = new Set(
      (this.config.policy.allowedArtifactExtensions ?? DEFAULT_ARTIFACT_EXTENSIONS).map(
        normalizeExtension,
      ),
    );
    const allowAnyExtension = allowedExtensions.has('*');
    const allowBinary = this.config.policy.allowBinaryArtifacts ?? false;

    if (declared.length > maxFiles) {
      throw new PathConfinementError(
        `declared artifact count ${declared.length} exceeds the ${maxFiles}-file limit`,
      );
    }

    const artifacts: ExtensibleArtifact[] = [];
    const canonicalPaths = new Set<string>();
    let totalBytes = 0;
    for (const relativePath of declared) {
      const extension = extname(relativePath).toLocaleLowerCase('en-US');
      if (!allowAnyExtension && !allowedExtensions.has(extension)) {
        throw new PathConfinementError(
          `artifact "${relativePath}" has disallowed extension "${extension || '(none)'}"`,
        );
      }

      const confined = await readConfinedRegularFile(cwd, relativePath, {
        maxBytes: maxArtifactBytes,
        allowBinary,
      });
      if (!confined) continue;
      if (canonicalPaths.has(confined.canonicalPath)) {
        throw new PathConfinementError(
          `artifact "${relativePath}" resolves to a duplicate declared file`,
        );
      }
      canonicalPaths.add(confined.canonicalPath);

      totalBytes += confined.content.byteLength;
      if (totalBytes > maxTotalBytes) {
        throw new PathConfinementError(
          `aggregate artifact size exceeds the ${maxTotalBytes}-byte limit`,
        );
      }

      const index = artifacts.length;
      const safeName = redactSensitiveText(relativePath, sensitiveValues);
      const checksum = createHash('sha256').update(confined.content).digest('hex');
      artifacts.push({
        artifactId: `${context.run.id}:artifact-${index}`,
        name: safeName,
        index,
        parts: [
          {
            type: 'file',
            file: {
              name: safeName,
              mimeType: inferArtifactMimeType(extension),
              bytes: confined.content.toString('base64'),
            },
          },
        ],
        metadata: {
          checksumSha256: checksum,
          sizeBytes: confined.content.byteLength,
          sourcePath: safeName,
        },
      });
    }
    return artifacts;
  }

  private clearRunTimeout(state: CliRunState): void {
    if (state.timeoutHandle) {
      clearTimeout(state.timeoutHandle);
      delete state.timeoutHandle;
    }
  }

  private releaseRunSlot(state: CliRunState): void {
    if (state.slotReleased) return;
    state.slotReleased = true;
    this.activeRunCount = Math.max(0, this.activeRunCount - 1);
  }

  private requireRun(context: WorkerRuntimeContext): CliRunState {
    const state = this.runs.get(context.run.id);
    if (!state) {
      throw new Error(`No active local CLI run for run id "${context.run.id}"`);
    }
    return state;
  }

  private buildEvent(
    context: WorkerRuntimeContext,
    partial: Partial<WorkerRuntimeEvent> & Pick<WorkerRuntimeEvent, 'type'>,
  ): WorkerRuntimeEvent {
    return {
      runId: context.run.id,
      workerId: this.id,
      taskId: context.task.id,
      timestamp: new Date().toISOString(),
      ...partial,
    };
  }

  private emit(
    context: WorkerRuntimeContext,
    partial: Partial<WorkerRuntimeEvent> & Pick<WorkerRuntimeEvent, 'type'>,
    state: CliRunState,
  ): WorkerRuntimeEvent {
    const event = this.buildEvent(context, partial);
    state.queue.push(event);
    return event;
  }
}

function normalizeExtension(extension: string): string {
  if (extension === '*') return extension;
  const lower = extension.toLocaleLowerCase('en-US');
  return lower.startsWith('.') ? lower : `.${lower}`;
}

function inferArtifactMimeType(extension: string): string {
  switch (extension) {
    case '.json':
    case '.jsonl':
      return 'application/json';
    case '.html':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.xml':
      return 'application/xml';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    default:
      return 'text/plain';
  }
}
