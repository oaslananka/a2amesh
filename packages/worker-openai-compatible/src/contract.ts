import type { WorkerCard } from '@a2amesh/internal-fleet';

export interface OpenAICompatibleChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAICompatibleChatCompletionResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAICompatibleWorkerClient {
  chat: {
    completions: {
      create(
        request: OpenAICompatibleChatCompletionRequest,
        options?: { signal?: AbortSignal },
      ): Promise<OpenAICompatibleChatCompletionResponse>;
    };
  };
}

export interface OpenAICompatibleWorkerRuntimePolicy {
  /** Maximum wall-clock time for one provider request. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum number of simultaneous requests for this worker instance. Defaults to one. */
  maxConcurrentRuns?: number;
  /** Maximum combined system and task prompt length. Defaults to 100,000 characters. */
  maxPromptCharacters?: number;
  /** Maximum accepted provider response length. Defaults to 100,000 characters. */
  maxOutputCharacters?: number;
}

export interface OpenAICompatibleWorkerRuntimeConfig {
  id: string;
  card: WorkerCard;
  /** Stable operator-defined provider family identifier, such as `nvidia-nim` or `opencode-zen`. */
  providerId: string;
  /** Provider model identifier passed to the documented OpenAI-compatible API. */
  model: string;
  /** Client created by the caller with credentials sourced outside this package. */
  client: OpenAICompatibleWorkerClient;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  policy?: OpenAICompatibleWorkerRuntimePolicy;
}
