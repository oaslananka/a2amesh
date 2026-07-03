import { randomUUID } from 'node:crypto';
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

export interface MockWorkerRuntimeStep {
  /** Delay in milliseconds before this step's event is emitted. Defaults to 0. */
  delayMs?: number;
  message?: string;
  artifact?: ExtensibleArtifact;
}

export interface MockWorkerRuntimeAdapterOptions {
  id: string;
  card: WorkerCard;
  /** Progress steps replayed by `stream()`. Defaults to a single "working" step. */
  steps?: readonly MockWorkerRuntimeStep[];
  /** When true, the run fails after replaying its steps instead of completing. */
  fail?: boolean;
  failureMessage?: string;
}

interface MockRunState {
  queue: AsyncEventQueue<WorkerRuntimeEvent>;
  lastEvent: WorkerRuntimeEvent;
  result?: WorkerRuntimeResult;
  canceled: boolean;
}

/**
 * Reference adapter used for Local Agent Mesh tests, demos, and the
 * quickstart. It implements the full `WorkerRuntimeContract` lifecycle
 * without spawning a real process, so it can exercise routing, streaming,
 * cancellation, and failure handling deterministically.
 */
export class MockWorkerRuntimeAdapter implements WorkerRuntimeContract {
  readonly id: string;
  readonly card: WorkerCard;
  private readonly steps: readonly MockWorkerRuntimeStep[];
  private readonly shouldFail: boolean;
  private readonly failureMessage: string;
  private readonly runs = new Map<string, MockRunState>();

  constructor(options: MockWorkerRuntimeAdapterOptions) {
    this.id = options.id;
    this.card = options.card;
    this.steps = options.steps ?? [{ message: 'working' }];
    this.shouldFail = options.fail ?? false;
    this.failureMessage = options.failureMessage ?? 'mock worker run failed';
  }

  async prepare(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const event = this.emit(context, { type: 'prepared', message: 'ready' });
    return event;
  }

  async start(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    const startedEvent = this.buildEvent(context, { type: 'started', message: 'started' });
    const state: MockRunState = { queue, lastEvent: startedEvent, canceled: false };
    this.runs.set(context.run.id, state);
    queue.push(startedEvent);
    void this.replay(context, state);
    return startedEvent;
  }

  private async replay(context: WorkerRuntimeContext, state: MockRunState): Promise<void> {
    for (const step of this.steps) {
      if (state.canceled) return;
      if (step.delayMs) await delay(step.delayMs);
      if (state.canceled) return;
      if (step.artifact) {
        state.lastEvent = this.emit(context, { type: 'artifact', artifact: step.artifact }, state);
      }
      state.lastEvent = this.emit(
        context,
        { type: 'task-update', message: step.message ?? 'progress' },
        state,
      );
    }
    if (state.canceled) return;

    if (this.shouldFail) {
      const failure: WorkerRuntimeFailure = {
        code: 'UNKNOWN',
        message: this.failureMessage,
        retryable: false,
      };
      this.emit(context, { type: 'failed', failure }, state);
      state.result = { status: 'FAILED', failure };
      state.queue.close();
      return;
    }

    const artifacts = this.steps
      .map((step) => step.artifact)
      .filter((artifact): artifact is ExtensibleArtifact => artifact !== undefined);
    state.lastEvent = this.emit(context, { type: 'finalized', message: 'completed' }, state);
    state.result = { status: 'COMPLETED', artifacts };
    state.queue.close();
  }

  stream(context: WorkerRuntimeContext): AsyncIterable<WorkerRuntimeEvent> {
    const state = this.requireRun(context);
    return state.queue;
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
      ...(status === 'FAILED' ? { summary: this.failureMessage } : {}),
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
    state.canceled = true;
    const event = this.emit(
      context,
      {
        type: 'canceled',
        message: request.reason ?? 'canceled',
      },
      state,
    );
    state.result = { status: 'CANCELED' };
    state.queue.close();
    return event;
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

  private requireRun(context: WorkerRuntimeContext): MockRunState {
    const state = this.runs.get(context.run.id);
    if (!state) {
      throw new Error(`No active mock run for run id "${context.run.id}"`);
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
    state?: MockRunState,
  ): WorkerRuntimeEvent {
    const event = this.buildEvent(context, partial);
    state?.queue.push(event);
    return event;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockRunId(): string {
  return randomUUID();
}
