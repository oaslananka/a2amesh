/**
 * @file A2AClient.ts
 * Basic HTTP + SSE client for A2A-compatible agents.
 */

import { EventSource, type EventSourceInit } from 'eventsource';
import type { AgentCard } from '../types/agent-card.js';
import type {
  A2AHealthResponse,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
  TaskPushNotificationConfig,
  TaskListParams,
  TaskListResult,
} from '../types/task.js';
import type { CallInterceptor } from './interceptors.js';
import type { VerificationKey } from '../security/AgentCardSigner.js';
import { createEventSourceReader } from './eventSourceReader.js';
import {
  createDefaultClientOutboundPolicy,
  createOutboundPolicyFetch,
  type OutboundPolicyOptions,
} from '../net/OutboundPolicy.js';
import type { A2AJsonRpcDialect } from '../utils/officialWire.js';
import {
  createA2AProtocolHeaders,
  fetchA2AAgentCard,
  getA2AProtocolPreferences,
  resolveA2AAgentCard,
  selectA2AAgentInterface,
  verifyResolvedA2AAgentCard,
  type A2AProtocolVersion,
} from './A2AClientAgentCard.js';
import {
  createA2AClientRpcTransport,
  type A2AClientRpcTransport,
} from './A2AClientRpcTransport.js';

export interface A2AClientOptions {
  fetchImplementation?: typeof fetch;
  /** Apply the centralized outbound URL, DNS, redirect, deadline, and response policy. */
  outboundPolicy?: OutboundPolicyOptions;
  cardPath?: string;
  rpcPath?: string;
  streamPath?: string;
  eventSourceImplementation?: typeof EventSource;
  interceptors?: CallInterceptor[];
  headers?: Record<string, string>;
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
    retryOn?: number[];
  };
  trustedVerificationKeys?: VerificationKey[];
  requireVerifiedAgentCard?: boolean;
  preferredProtocolVersion?: A2AProtocolVersion;
  allowExperimentalProtocolVersions?: boolean;
  /** Select the JSON-RPC method and payload dialect. Defaults to the Mesh-compatible dialect. */
  jsonRpcDialect?: A2AJsonRpcDialect;
}

interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
  retryOn: number[];
}

export type {
  A2AOfficialProtocolVersion,
  A2AExperimentalProtocolVersion,
  A2AProtocolVersion,
} from './A2AClientAgentCard.js';

/**
 * HTTP and SSE client for interacting with A2A-compatible agents.
 *
 * @example
 * ```ts
 * const client = new A2AClient('http://localhost:3000');
 * const task = await client.sendMessage({
 *   role: 'user',
 *   parts: [{ type: 'text', text: 'Summarize this' }],
 *   messageId: crypto.randomUUID(),
 *   timestamp: new Date().toISOString(),
 * });
 * ```
 * @since 1.0.0
 */
export class A2AClient {
  public static readonly supportedVersions = ['1.0'] as const;
  public static readonly experimentalProtocolVersions = ['1.2'] as const;
  private readonly fetchImplementation: typeof fetch;
  private readonly cardPath: string;
  private readonly rpcPath: string;
  private readonly streamPath: string;
  private readonly eventSourceImplementation: typeof EventSource;
  private readonly interceptors: CallInterceptor[];
  private readonly headers: Record<string, string>;
  private readonly retry: RetryOptions;
  private readonly trustedVerificationKeys: VerificationKey[];
  private readonly requireVerifiedAgentCard: boolean;
  private readonly protocolVersion: A2AProtocolVersion;
  private readonly jsonRpcDialect: A2AJsonRpcDialect;
  private readonly rpcTransport: A2AClientRpcTransport;

  constructor(
    public readonly baseUrl: string,
    options: A2AClientOptions = {},
  ) {
    this.fetchImplementation =
      options.fetchImplementation ??
      createOutboundPolicyFetch(
        options.outboundPolicy ?? createDefaultClientOutboundPolicy(this.baseUrl),
      );
    this.cardPath = options.cardPath ?? '/.well-known/agent-card.json';
    this.rpcPath = options.rpcPath ?? '/a2a/jsonrpc';
    this.streamPath = options.streamPath ?? '/a2a/stream';
    this.eventSourceImplementation = options.eventSourceImplementation ?? EventSource;
    this.interceptors = options.interceptors ?? [];
    this.headers = options.headers ?? {};
    this.retry = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      backoffMs: options.retry?.backoffMs ?? 1000,
      retryOn: options.retry?.retryOn ?? [502, 503, 504],
    };
    this.trustedVerificationKeys = options.trustedVerificationKeys ?? [];
    this.requireVerifiedAgentCard = options.requireVerifiedAgentCard ?? false;
    this.protocolVersion = getA2AProtocolPreferences(options)[0] ?? '1.0';
    this.jsonRpcDialect = options.jsonRpcDialect ?? 'mesh';
    this.rpcTransport = createA2AClientRpcTransport({
      baseUrl: this.baseUrl,
      rpcPath: this.rpcPath,
      protocolVersion: this.protocolVersion,
      jsonRpcDialect: this.jsonRpcDialect,
      interceptors: this.interceptors,
      headers: this.headers,
      fetchWithRetry: (input, init) => this.fetchWithRetry(input, init),
    });
  }

  static async connect(agentCardUrl: string, options: A2AClientOptions = {}): Promise<A2AClient> {
    const fetchImplementation =
      options.fetchImplementation ??
      createOutboundPolicyFetch(
        options.outboundPolicy ?? createDefaultClientOutboundPolicy(agentCardUrl),
      );
    const card = await fetchA2AAgentCard(
      agentCardUrl,
      fetchImplementation,
      createA2AProtocolHeaders(options.headers, options.preferredProtocolVersion),
      (resolvedCard) => verifyResolvedA2AAgentCard(resolvedCard, options),
    );
    const selectedInterface = selectA2AAgentInterface(card, options) ?? {
      url: card.url,
      protocolBinding: 'HTTP+JSON' as const,
      protocolVersion: '0.3' as const,
    };

    const clientOptions: A2AClientOptions = {
      ...options,
      outboundPolicy: options.outboundPolicy ?? createDefaultClientOutboundPolicy(agentCardUrl),
    };
    if (selectedInterface.protocolVersion === '1.2') {
      clientOptions.preferredProtocolVersion = '1.2';
    }

    return new A2AClient(selectedInterface.url, clientOptions);
  }

  async resolveCard(): Promise<AgentCard> {
    return resolveA2AAgentCard({
      baseUrl: this.baseUrl,
      cardPath: this.cardPath,
      headers: createA2AProtocolHeaders(this.headers, this.protocolVersion),
      fetchWithRetry: (input, init) => this.fetchWithRetry(input, init),
      verifyCard: (card) =>
        verifyResolvedA2AAgentCard(card, {
          trustedVerificationKeys: this.trustedVerificationKeys,
          requireVerifiedAgentCard: this.requireVerifiedAgentCard,
        }),
    });
  }

  async sendMessage(params: Message | MessageSendParams): Promise<Task> {
    return this.rpcTransport.rpc<Task, MessageSendParams>(
      'message/send',
      this.normalizeParams(params),
    );
  }

  async sendMessageStream(params: Message | MessageSendParams): Promise<AsyncGenerator<unknown>> {
    return this.rpcTransport.streamRpc<Task, MessageSendParams>(
      'message/stream',
      this.normalizeParams(params),
    );
  }

  subscribeTask(taskId: string): AsyncGenerator<unknown> {
    return this.subscribeToTask(taskId);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.rpcTransport.rpc<Task, { taskId: string }>('tasks/get', { taskId });
  }

  async listTasks(params: TaskListParams = {}): Promise<TaskListResult> {
    return this.rpcTransport.rpc<TaskListResult, TaskListParams>('tasks/list', params);
  }

  async cancelTask(taskId: string): Promise<Task> {
    return this.rpcTransport.rpc<Task, { taskId: string }>('tasks/cancel', { taskId });
  }

  async setPushNotification(
    taskId: string,
    pushNotificationConfig: PushNotificationConfig,
  ): Promise<PushNotificationConfig> {
    return this.rpcTransport.rpc<
      PushNotificationConfig,
      { taskId: string; pushNotificationConfig: PushNotificationConfig }
    >('tasks/pushNotification/set', {
      taskId,
      pushNotificationConfig,
    });
  }

  async getPushNotification(taskId: string): Promise<PushNotificationConfig | null> {
    return this.rpcTransport.rpc<PushNotificationConfig | null, { taskId: string }>(
      'tasks/pushNotification/get',
      {
        taskId,
      },
    );
  }

  async createPushNotificationConfig(
    taskId: string,
    pushNotificationConfig: PushNotificationConfig,
    configId = pushNotificationConfig.id,
  ): Promise<PushNotificationConfig> {
    return this.rpcTransport.rpc<
      PushNotificationConfig,
      TaskPushNotificationConfig & { configId?: string | undefined }
    >('tasks/pushNotificationConfig/create', {
      taskId,
      pushNotificationConfig,
      ...(configId ? { configId } : {}),
    });
  }

  async getPushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<PushNotificationConfig | null> {
    return this.rpcTransport.rpc<
      PushNotificationConfig | null,
      { taskId: string; configId: string }
    >('tasks/pushNotificationConfig/get', { taskId, configId });
  }

  async listPushNotificationConfigs(
    taskId: string,
  ): Promise<{ configs: PushNotificationConfig[] }> {
    return this.rpcTransport.rpc<{ configs: PushNotificationConfig[] }, { taskId: string }>(
      'tasks/pushNotificationConfig/list',
      { taskId },
    );
  }

  async deletePushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<{ deleted: boolean }> {
    return this.rpcTransport.rpc<{ deleted: boolean }, { taskId: string; configId: string }>(
      'tasks/pushNotificationConfig/delete',
      { taskId, configId },
    );
  }

  async getAuthenticatedExtendedCard(): Promise<AgentCard> {
    return this.rpcTransport.rpc<AgentCard, Record<string, never>>(
      'agent/getAuthenticatedExtendedCard',
      {},
    );
  }

  async authenticatedExtendedCard(): Promise<AgentCard> {
    return this.rpcTransport.rpc<AgentCard, Record<string, never>>(
      'agent/authenticatedExtendedCard',
      {},
    );
  }

  async health(): Promise<A2AHealthResponse> {
    const response = await this.fetchWithRetry(new URL('/health', this.baseUrl), {
      headers: createA2AProtocolHeaders(this.headers, this.protocolVersion),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Health check failed with status ${response.status}`);
    }
    return (await response.json()) as A2AHealthResponse;
  }

  private normalizeParams(params: Message | MessageSendParams): MessageSendParams {
    if ('message' in params) {
      return params;
    }

    return { message: params };
  }

  private async *subscribeToTask(taskId: string): AsyncGenerator<unknown> {
    const streamUrl = new URL(this.streamPath, this.baseUrl);
    streamUrl.searchParams.set('taskId', taskId);

    const source = new this.eventSourceImplementation(
      streamUrl.toString(),
      this.createEventSourceInit() as EventSourceInit,
    );

    for await (const data of createEventSourceReader<unknown>(source, 'task_updated')) {
      yield data;
      if (
        data &&
        typeof data === 'object' &&
        'status' in data &&
        typeof data.status === 'object' &&
        data.status !== null &&
        'state' in data.status &&
        ['COMPLETED', 'FAILED', 'CANCELED', 'completed', 'failed', 'canceled'].includes(
          String(data.status.state),
        )
      ) {
        break;
      }
    }
  }

  private createEventSourceInit():
    | EventSourceInit
    | { headers: Record<string, string> }
    | undefined {
    const hasHeaders = Object.keys(this.headers).length > 0;
    const supportsFetchOverride =
      Symbol.for('eventsource.supports-fetch-override') in this.eventSourceImplementation;

    if (supportsFetchOverride && (hasHeaders || this.fetchImplementation !== fetch)) {
      const eventSourceInit: EventSourceInit = {
        fetch: (input, init) => {
          const headers = new Headers(init.headers);
          for (const [key, value] of Object.entries(
            createA2AProtocolHeaders(this.headers, this.protocolVersion),
          )) {
            headers.set(key, value);
          }

          return this.fetchImplementation(input, { ...init, headers });
        },
      };
      return eventSourceInit;
    }

    if (hasHeaders) {
      return { headers: createA2AProtocolHeaders(this.headers, this.protocolVersion) };
    }

    return undefined;
  }

  private async fetchWithRetry(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    let lastError: unknown;
    const maxAttempts = isRetrySafeRequest(init) ? this.retry.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImplementation(input, init);
        if (
          response.ok ||
          attempt === maxAttempts ||
          !this.retry.retryOn.includes(response.status)
        ) {
          return response;
        }
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) {
          throw error;
        }
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.retry.backoffMs * attempt);
      });
    }

    throw new Error(`Request failed after ${maxAttempts} attempts: ${String(lastError)}`);
  }
}

const RETRY_SAFE_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']);

function isRetrySafeRequest(init: RequestInit | undefined): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  return RETRY_SAFE_METHODS.has(method) || new Headers(init?.headers).has('Idempotency-Key');
}
