import { createHash, randomUUID } from 'node:crypto';
import type { ExtensibleArtifact } from '@a2amesh/protocol';
import type { FleetSideEffectLevel, WorkerCard } from '@a2amesh/internal-fleet';
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

import type {
  OpenAICompatibleChatCompletionRequest,
  OpenAICompatibleWorkerRuntimeConfig,
} from './contract.js';
import {
  classifyProviderFailure,
  hasChecksum,
  mapUsage,
  requiredText,
  validatePolicy,
  validatePositiveOptional,
  validateTemperature,
  type ProviderRunState,
} from './runtimeSupport.js';

export type {
  OpenAICompatibleChatCompletionRequest,
  OpenAICompatibleChatCompletionResponse,
  OpenAICompatibleWorkerClient,
  OpenAICompatibleWorkerRuntimeConfig,
  OpenAICompatibleWorkerRuntimePolicy,
} from './contract.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_RUNS = 1;
const DEFAULT_MAX_PROMPT_CHARACTERS = 100_000;
const DEFAULT_MAX_OUTPUT_CHARACTERS = 100_000;
const ALLOWED_SIDE_EFFECT: FleetSideEffectLevel = 'read-only';

export class OpenAICompatibleWorkerRuntimeAdapter implements WorkerRuntimeContract {
  readonly id: string;
  readonly card: WorkerCard;

  private readonly config: OpenAICompatibleWorkerRuntimeConfig;
  private readonly runs = new Map<string, ProviderRunState>();
  private activeRunCount = 0;

  constructor(config: OpenAICompatibleWorkerRuntimeConfig) {
    this.id = requiredText(config.id, 'worker id');
    this.card = config.card;
    this.config = {
      ...config,
      providerId: requiredText(config.providerId, 'provider id'),
      model: requiredText(config.model, 'model'),
    };
    validatePositiveOptional(config.maxTokens, 'maxTokens');
    validateTemperature(config.temperature);
    validatePolicy(config.policy);
  }

  async prepare(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const failure = this.admissionFailure(context);
    if (failure) return this.buildEvent(context, { type: 'failed', failure });
    return this.buildEvent(context, {
      type: 'prepared',
      message: 'documented provider API admission passed',
      metadata: this.safeProviderMetadata(),
    });
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
          failure: {
            code: 'POLICY_DENIED',
            operation: 'start',
            message: 'Run id is already bound to a different task or worker.',
            retryable: false,
          },
        });
      }
      return existing.startEvent;
    }

    const failure = this.admissionFailure(context) ?? this.reserveRunSlot();
    if (failure) return this.recordStartFailure(context, failure);

    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    const abortController = new AbortController();
    const startedEvent = this.buildEvent(context, {
      type: 'started',
      message: 'provider request starting',
      metadata: this.safeProviderMetadata(),
    });
    const state: ProviderRunState = {
      queue,
      startEvent: startedEvent,
      lastEvent: startedEvent,
      taskId: context.task.id,
      workerId: context.run.workerId,
      abortController,
      timedOut: false,
      slotReleased: false,
    };
    this.runs.set(context.run.id, state);
    queue.push(startedEvent);

    const timeoutMs = this.resolveTimeoutMs(context);
    state.timeoutHandle = setTimeout(() => {
      state.timedOut = true;
      abortController.abort(new Error('provider request timeout'));
    }, timeoutMs);

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
    if (!state.result) {
      return {
        status: 'SKIPPED',
        verifierWorkerId: this.id,
        checkedAt: new Date().toISOString(),
        summary: 'provider run has not reached a terminal state',
      };
    }

    const passed =
      state.result.status === 'COMPLETED' &&
      state.result.artifacts?.some((artifact) => hasChecksum(artifact)) === true;
    return {
      status: passed ? 'PASSED' : 'FAILED',
      verifierWorkerId: this.id,
      checkedAt: new Date().toISOString(),
      summary: passed
        ? 'provider response artifact is present and checksummed'
        : 'provider run did not produce a verified artifact',
      ...(passed || !state.result.failure ? {} : { failures: [state.result.failure] }),
      metadata: this.safeProviderMetadata(),
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
    if (state.result) return state.lastEvent;

    state.abortController.abort(new Error('provider request canceled'));
    this.clearTimeout(state);
    this.releaseRunSlot(state);
    const event = this.emit(context, state, {
      type: 'canceled',
      status: 'CANCELED',
      message: request.reason ?? 'provider request canceled',
      metadata: {
        ...this.safeProviderMetadata(),
        requestedBy: request.requestedBy ?? 'operator',
      },
    });
    state.result = { status: 'CANCELED' };
    state.queue.close();
    return event;
  }

  async cleanup(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent> {
    const state = this.runs.get(context.run.id);
    if (state) {
      if (!state.result) state.abortController.abort(new Error('provider run cleaned up'));
      this.clearTimeout(state);
      this.releaseRunSlot(state);
      state.queue.close();
      this.runs.delete(context.run.id);
    }
    return this.buildEvent(context, {
      type: 'cleaned-up',
      message: 'provider run state removed',
      ...(state?.result?.status ? { status: state.result.status } : {}),
      metadata: this.safeProviderMetadata(),
    });
  }

  private async execute(context: WorkerRuntimeContext, state: ProviderRunState): Promise<void> {
    this.emit(context, state, {
      type: 'task-update',
      status: 'RUNNING',
      message: 'provider inference in progress',
      metadata: this.safeProviderMetadata(),
    });

    try {
      const response = await this.config.client.chat.completions.create(
        this.buildRequest(context),
        { signal: state.abortController.signal },
      );
      if (state.result) return;

      const text = response.choices[0]?.message.content?.trim() ?? '';
      if (!text) {
        this.finishWithFailure(context, state, {
          code: 'ARTIFACT_UNAVAILABLE',
          operation: 'finalize',
          message: 'Provider returned no usable text response.',
          retryable: false,
        });
        return;
      }
      if (text.length > this.maxOutputCharacters()) {
        this.finishWithFailure(context, state, {
          code: 'ARTIFACT_UNAVAILABLE',
          operation: 'finalize',
          message: 'Provider response exceeded the configured output boundary.',
          retryable: false,
        });
        return;
      }

      const artifact = this.createArtifact(context, text);
      const usage = mapUsage(response.usage);
      this.emit(context, state, { type: 'artifact', artifact });
      if (usage) this.emit(context, state, { type: 'usage', usage });
      this.clearTimeout(state);
      this.releaseRunSlot(state);
      state.result = {
        status: 'COMPLETED',
        artifacts: [artifact],
        ...(usage ? { usage } : {}),
        metadata: this.safeProviderMetadata(),
      };
      this.emit(context, state, {
        type: 'finalized',
        status: 'COMPLETED',
        message: 'provider inference completed',
        metadata: this.safeProviderMetadata(),
      });
      state.queue.close();
    } catch (error) {
      if (state.result) return;
      const failure = classifyProviderFailure(error, state);
      this.finishWithFailure(
        context,
        state,
        failure,
        failure.code === 'CANCELED' ? 'canceled' : 'failed',
      );
    }
  }

  private buildRequest(context: WorkerRuntimeContext): OpenAICompatibleChatCompletionRequest {
    const messages: OpenAICompatibleChatCompletionRequest['messages'] = [];
    if (this.config.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: this.config.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: context.task.description?.trim() ?? '' });
    return {
      model: this.config.model,
      messages,
      ...(this.config.maxTokens === undefined ? {} : { max_tokens: this.config.maxTokens }),
      ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
    };
  }

  private createArtifact(context: WorkerRuntimeContext, text: string): ExtensibleArtifact {
    return {
      artifactId: randomUUID(),
      name: 'OpenAI-compatible provider response',
      description: 'Text result returned by a documented OpenAI-compatible provider API.',
      parts: [{ type: 'text', text }],
      index: 0,
      lastChunk: true,
      metadata: {
        ...this.safeProviderMetadata(),
        contentType: 'text/plain; charset=utf-8',
        checksumSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        taskId: context.task.id,
        runId: context.run.id,
      },
    };
  }

  private admissionFailure(context: WorkerRuntimeContext): WorkerRuntimeFailure | undefined {
    if (context.worker.id !== this.id || context.run.workerId !== this.id) {
      return {
        code: 'POLICY_DENIED',
        operation: 'prepare',
        message: 'Worker identity does not match the admitted run.',
        retryable: false,
      };
    }
    if (!context.task.description?.trim()) {
      return {
        code: 'CAPABILITY_UNAVAILABLE',
        operation: 'prepare',
        message: 'OpenAI-compatible worker requires a non-empty text task description.',
        retryable: false,
      };
    }

    if (this.promptCharacterCount(context) > this.maxPromptCharacters()) {
      return {
        code: 'CAPABILITY_UNAVAILABLE',
        operation: 'prepare',
        message: 'Combined provider prompt exceeds the configured character boundary.',
        retryable: false,
      };
    }

    const sideEffectLevel = context.metadata?.['sideEffectLevel'];
    if (sideEffectLevel !== undefined && sideEffectLevel !== ALLOWED_SIDE_EFFECT) {
      return {
        code: 'POLICY_DENIED',
        operation: 'prepare',
        message: 'OpenAI-compatible worker permits read-only inference only.',
        retryable: false,
      };
    }

    const requestedTools = context.metadata?.['requestedProviderTools'];
    if (Array.isArray(requestedTools) && requestedTools.length > 0) {
      return {
        code: 'CAPABILITY_UNAVAILABLE',
        operation: 'prepare',
        message: 'OpenAI-compatible worker does not execute provider tools.',
        retryable: false,
      };
    }

    if (this.resolveTimeoutMs(context) <= 0) {
      return {
        code: 'TIMEOUT',
        operation: 'prepare',
        message: 'Provider run deadline has already expired.',
        retryable: false,
      };
    }
    return undefined;
  }

  private reserveRunSlot(): WorkerRuntimeFailure | undefined {
    if (this.activeRunCount >= this.maxConcurrentRuns()) {
      return {
        code: 'WORKER_UNAVAILABLE',
        operation: 'start',
        message: 'Provider worker concurrency limit reached.',
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
    const queue = new AsyncEventQueue<WorkerRuntimeEvent>();
    const abortController = new AbortController();
    const event = this.buildEvent(context, { type: 'failed', status: 'FAILED', failure });
    const state: ProviderRunState = {
      queue,
      startEvent: event,
      lastEvent: event,
      taskId: context.task.id,
      workerId: context.run.workerId,
      abortController,
      result: { status: 'FAILED', failure },
      timedOut: false,
      slotReleased: true,
    };
    this.runs.set(context.run.id, state);
    queue.push(event);
    queue.close();
    return event;
  }

  private finishWithFailure(
    context: WorkerRuntimeContext,
    state: ProviderRunState,
    failure: WorkerRuntimeFailure,
    eventType: 'failed' | 'canceled' = 'failed',
  ): void {
    this.clearTimeout(state);
    this.releaseRunSlot(state);
    const status = eventType === 'canceled' ? 'CANCELED' : 'FAILED';
    state.result = { status, failure, metadata: this.safeProviderMetadata() };
    this.emit(context, state, { type: eventType, status, failure });
    state.queue.close();
  }

  private resolveTimeoutMs(context: WorkerRuntimeContext): number {
    const candidates = [
      this.config.policy?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      context.timeoutMs,
      context.deadlineAt ? Date.parse(context.deadlineAt) - Date.now() : undefined,
    ].filter((value): value is number => Number.isFinite(value));
    return Math.max(0, Math.min(...candidates));
  }

  private maxConcurrentRuns(): number {
    return this.config.policy?.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
  }

  private maxPromptCharacters(): number {
    return this.config.policy?.maxPromptCharacters ?? DEFAULT_MAX_PROMPT_CHARACTERS;
  }

  private promptCharacterCount(context: WorkerRuntimeContext): number {
    return (
      (this.config.systemPrompt?.trim().length ?? 0) +
      (context.task.description?.trim().length ?? 0)
    );
  }

  private maxOutputCharacters(): number {
    return this.config.policy?.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS;
  }

  private safeProviderMetadata(): Record<string, unknown> {
    return {
      providerId: this.config.providerId,
      model: this.config.model,
      integrationSurface: 'official-api',
      credentialPolicy: 'external-client',
      toolsEnabled: false,
    };
  }

  private requireRun(context: WorkerRuntimeContext): ProviderRunState {
    const state = this.runs.get(context.run.id);
    if (!state) throw new Error(`No provider run exists for run id "${context.run.id}".`);
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
    state: ProviderRunState,
    partial: Partial<WorkerRuntimeEvent> & Pick<WorkerRuntimeEvent, 'type'>,
  ): WorkerRuntimeEvent {
    const event = this.buildEvent(context, partial);
    state.lastEvent = event;
    state.queue.push(event);
    return event;
  }

  private clearTimeout(state: ProviderRunState): void {
    if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
    delete state.timeoutHandle;
  }

  private releaseRunSlot(state: ProviderRunState): void {
    if (state.slotReleased) return;
    state.slotReleased = true;
    this.activeRunCount = Math.max(0, this.activeRunCount - 1);
  }
}
