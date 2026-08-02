import type { ExtensibleArtifact } from '@a2amesh/protocol';
import type {
  AsyncEventQueue,
  WorkerRuntimeEvent,
  WorkerRuntimeFailure,
  WorkerRuntimeResult,
  WorkerRuntimeUsage,
} from '@a2amesh/internal-worker-runtime';
import type {
  OpenAICompatibleChatCompletionResponse,
  OpenAICompatibleWorkerRuntimePolicy,
} from './contract.js';

export interface ProviderFailureState {
  abortController: AbortController;
  timedOut: boolean;
}

export interface ProviderRunState extends ProviderFailureState {
  queue: AsyncEventQueue<WorkerRuntimeEvent>;
  startEvent: WorkerRuntimeEvent;
  lastEvent: WorkerRuntimeEvent;
  taskId: string;
  workerId: string;
  result?: WorkerRuntimeResult;
  timeoutHandle?: NodeJS.Timeout;
  slotReleased: boolean;
}

export function classifyProviderFailure(
  error: unknown,
  state: ProviderFailureState,
): WorkerRuntimeFailure {
  if (state.abortController.signal.aborted) {
    return state.timedOut
      ? {
          code: 'TIMEOUT',
          operation: 'start',
          message: 'Provider request exceeded the configured timeout.',
          retryable: true,
        }
      : {
          code: 'CANCELED',
          operation: 'cancel',
          message: 'Provider request was canceled.',
          retryable: false,
        };
  }

  const status = readNumberProperty(error, 'status');
  if (status === 429) {
    return {
      code: 'WORKER_UNAVAILABLE',
      operation: 'start',
      message: 'Provider rate limited the request.',
      retryable: true,
      details: { status },
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: 'POLICY_DENIED',
      operation: 'start',
      message: 'Provider authentication or authorization failed.',
      retryable: false,
      details: { status },
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      code: 'WORKER_UNAVAILABLE',
      operation: 'start',
      message: 'Provider service is unavailable.',
      retryable: true,
      details: { status },
    };
  }
  return {
    code: 'UNKNOWN',
    operation: 'start',
    message: 'Provider request failed.',
    retryable: false,
    ...(status === undefined ? {} : { details: { status } }),
  };
}

export function mapUsage(
  usage: OpenAICompatibleChatCompletionResponse['usage'],
): WorkerRuntimeUsage | undefined {
  if (!usage) return undefined;
  const mapped: WorkerRuntimeUsage = {
    ...(usage.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens === undefined ? {} : { outputTokens: usage.completion_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
  };
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function hasChecksum(artifact: ExtensibleArtifact): boolean {
  return typeof artifact.metadata?.['checksumSha256'] === 'string';
}

export function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must be a non-empty string.`);
  return normalized;
}

export function validatePositiveOptional(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function validateTemperature(value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 2)) {
    throw new Error('temperature must be between 0 and 2.');
  }
}

export function validatePolicy(policy: OpenAICompatibleWorkerRuntimePolicy | undefined): void {
  validatePositiveOptional(policy?.timeoutMs, 'policy.timeoutMs');
  validatePositiveOptional(policy?.maxConcurrentRuns, 'policy.maxConcurrentRuns');
  validatePositiveOptional(policy?.maxPromptCharacters, 'policy.maxPromptCharacters');
  validatePositiveOptional(policy?.maxOutputCharacters, 'policy.maxOutputCharacters');
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined;
}
