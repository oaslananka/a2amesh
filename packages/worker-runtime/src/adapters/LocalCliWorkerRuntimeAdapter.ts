import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';
import type { ExtensibleArtifact } from '@a2amesh/protocol';
import type { WorkerCard } from '@a2amesh/internal-fleet';
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
  /** Executable names permitted to run. The configured `command` must be a member. */
  commandAllowlist: readonly string[];
  /** Names of environment variables that may be forwarded from the host process. Empty by default. */
  envAllowlist?: readonly string[];
  /** Absolute path all resolved working directories must stay within. */
  workspaceRoot: string;
  /** Milliseconds before an in-flight run is aborted. Defaults to 120000. */
  timeoutMs?: number;
  /** Caps combined stdout+stderr bytes captured per run. Defaults to 1MB. */
  maxOutputBytes?: number;
  /** Caps concurrently running processes for this adapter instance. Defaults to 1. */
  maxConcurrentRuns?: number;
}

export interface LocalCliWorkerRuntimeConfig {
  id: string;
  card: WorkerCard;
  /** Executable to invoke. Must appear in `policy.commandAllowlist`. */
  command: string;
  /** Fixed arguments prepended to every invocation. */
  baseArgs?: readonly string[];
  /** Builds task-specific CLI arguments. Defaults to `[context.task.description ?? context.task.id]`. */
  buildArgs?: (context: WorkerRuntimeContext) => readonly string[];
  /** Working directory, resolved relative to `policy.workspaceRoot`. Defaults to the workspace root itself. */
  cwd?: string;
  /** Explicit environment values merged in after allowlist filtering. Never sourced from secrets by default. */
  env?: Readonly<Record<string, string>>;
  /** Declares output files (relative to the resolved cwd) to capture as artifacts once the run completes. */
  artifactFiles?: (context: WorkerRuntimeContext) => readonly string[];
  policy: LocalCliWorkerRuntimePolicy;
}

interface CliRunState {
  queue: AsyncEventQueue<WorkerRuntimeEvent>;
  lastEvent: WorkerRuntimeEvent;
  result?: WorkerRuntimeResult;
  abortController: AbortController;
  timeoutHandle?: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_MAX_CONCURRENT_RUNS = 1;

/**
 * Generic local CLI agent adapter (#90). Wraps an allowlisted command in a
 * scoped workspace with no secret passthrough by default, structured
 * failure results, timeouts, cancellation, and declared-artifact capture.
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
    const denial = this.evaluatePolicy(context);
    if (denial) {
      return this.buildEvent(context, { type: 'failed', failure: denial });
    }
    return this.buildEvent(context, { type: 'prepared', message: 'policy checks passed' });
  }

  async start(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const denial = this.evaluatePolicy(context);
    if (denial) {
      const event = this.buildEvent(context, { type: 'failed', failure: denial });
      const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
      queue.push(event);
      queue.close();
      this.runs.set(context.run.id, {
        queue,
        lastEvent: event,
        result: { status: 'FAILED', failure: denial },
        abortController: new AbortController(),
      });
      return event;
    }

    this.activeRunCount += 1;
    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    const abortController = new AbortController();
    const startedEvent = this.buildEvent(context, { type: 'started', message: 'process starting' });
    const state: CliRunState = { queue, lastEvent: startedEvent, abortController };
    this.runs.set(context.run.id, state);
    queue.push(startedEvent);

    const timeoutMs = this.config.policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    state.timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`local CLI run exceeded ${timeoutMs}ms timeout`));
    }, timeoutMs);

    void this.run(context, state);
    return startedEvent;
  }

  private async run(context: WorkerRuntimeContext, state: CliRunState): Promise<void> {
    const cwd = this.resolveCwd();
    const args = [...(this.config.baseArgs ?? []), ...this.buildTaskArgs(context)];
    const maxOutputBytes = this.config.policy.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const env = this.buildEnv();

    let outputBytes = 0;
    const appendOutput = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      if (outputBytes >= maxOutputBytes) return;
      const text = chunk.toString('utf8').slice(0, maxOutputBytes - outputBytes);
      outputBytes += Buffer.byteLength(text, 'utf8');
      for (const line of text.split(/\r?\n/).filter((value) => value.length > 0)) {
        state.lastEvent = this.emit(
          context,
          { type: 'task-update', message: `[${stream}] ${line}` },
          state,
        );
      }
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(this.config.command, args, {
        cwd,
        env,
        signal: state.abortController.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.finishWithFailure(context, state, {
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : 'failed to spawn local CLI process',
      });
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => appendOutput(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => appendOutput(chunk, 'stderr'));

    const finishAbort = (): void => {
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
      if (state.result) return;
      const reason = state.abortController.signal.reason;
      const timedOut = reason instanceof Error && reason.message.includes('timeout');
      this.finishWithFailure(
        context,
        state,
        {
          code: timedOut ? 'TIMEOUT' : 'CANCELED',
          message: reason instanceof Error ? reason.message : 'run aborted',
          retryable: timedOut,
        },
        timedOut ? 'failed' : 'canceled',
      );
    };

    child.on('error', (error) => {
      if (state.abortController.signal.aborted) {
        finishAbort();
        return;
      }
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
      if (state.result) return;
      this.finishWithFailure(context, state, {
        code: 'UNKNOWN',
        message: error.message,
      });
    });

    child.on('close', (exitCode, signal) => {
      if (state.abortController.signal.aborted) {
        finishAbort();
        return;
      }
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
      if (state.result) return;

      if (exitCode !== 0) {
        this.finishWithFailure(context, state, {
          code: 'UNKNOWN',
          message: `command exited with code ${exitCode ?? 'null'}${signal ? ` (signal ${signal})` : ''}`,
        });
        return;
      }

      void this.captureArtifacts(context, cwd).then((artifacts) => {
        state.lastEvent = this.emit(context, { type: 'finalized', message: 'completed' }, state);
        state.result = { status: 'COMPLETED', artifacts };
        state.queue.close();
      });
    });
  }

  private finishWithFailure(
    context: WorkerRuntimeContext,
    state: CliRunState,
    failure: WorkerRuntimeFailure,
    eventType: 'failed' | 'canceled' = 'failed',
  ): void {
    if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
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

  private evaluatePolicy(context: WorkerRuntimeContext): WorkerRuntimeFailure | undefined {
    const { policy } = this.config;

    if (!policy.commandAllowlist.includes(this.config.command)) {
      return {
        code: 'POLICY_DENIED',
        message: `command "${this.config.command}" is not in the local CLI adapter allowlist`,
        operation: 'prepare',
      };
    }

    try {
      this.resolveCwd();
    } catch (error) {
      return {
        code: 'POLICY_DENIED',
        message:
          error instanceof Error ? error.message : 'working directory is outside the workspace',
        operation: 'prepare',
      };
    }

    const maxConcurrentRuns = policy.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
    if (this.activeRunCount >= maxConcurrentRuns) {
      return {
        code: 'POLICY_DENIED',
        message: `local CLI adapter "${this.id}" is at its concurrency limit (${maxConcurrentRuns})`,
        operation: 'prepare',
        retryable: true,
      };
    }

    void context;
    return undefined;
  }

  private resolveCwd(): string {
    const workspaceRoot = resolvePath(this.config.policy.workspaceRoot);
    const candidate = this.config.cwd
      ? isAbsolute(this.config.cwd)
        ? this.config.cwd
        : resolvePath(workspaceRoot, this.config.cwd)
      : workspaceRoot;
    const resolved = resolvePath(candidate);
    const rel = relative(workspaceRoot, resolved);
    if (rel === '..' || rel.startsWith(`..${'/'}`) || (isAbsolute(rel) && rel !== '')) {
      throw new Error(
        `resolved working directory "${resolved}" escapes workspace root "${workspaceRoot}"`,
      );
    }
    return resolved;
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
    // PATH is required to resolve the allowlisted executable and is not
    // itself credential material, so it is forwarded regardless of the
    // allowlist. No other ambient environment variables pass through.
    if (process.env['PATH'] !== undefined) forwarded['PATH'] = process.env['PATH'];
    return { ...forwarded, ...(this.config.env ?? {}) };
  }

  private async captureArtifacts(
    context: WorkerRuntimeContext,
    cwd: string,
  ): Promise<ExtensibleArtifact[]> {
    const declared = this.config.artifactFiles?.(context) ?? [];
    const artifacts: ExtensibleArtifact[] = [];
    let index = 0;
    for (const relativePath of declared) {
      const absolutePath = resolvePath(cwd, relativePath);
      const rel = relative(cwd, absolutePath);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        continue; // declared artifact escapes the run's working directory; skip rather than leak
      }
      try {
        const content = await readFile(absolutePath);
        const checksum = createHash('sha256').update(content).digest('hex');
        artifacts.push({
          artifactId: `${context.run.id}:${relativePath}`,
          name: relativePath,
          index: index++,
          parts: [
            {
              type: 'file',
              file: {
                name: relativePath,
                mimeType: 'application/octet-stream',
                bytes: content.toString('base64'),
              },
            },
          ],
          metadata: { checksumSha256: checksum, sizeBytes: content.byteLength },
        });
      } catch {
        // declared artifact file was not produced; omit rather than fail the run
      }
    }
    return artifacts;
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
