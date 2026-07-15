/**
 * @file A2AClient.ts
 * Basic HTTP + SSE client for A2A-compatible agents.
 */

import { EventSource, type EventSourceInit } from 'eventsource';
import { context, propagation } from '@opentelemetry/api';
import type { AgentCard, SupportedInterface } from '../types/agent-card.js';
import type {
  JsonRpcFailureResponse,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from '../types/jsonrpc.js';
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
import type { AfterArgs, CallInterceptor, ClientCallOptions } from './interceptors.js';
import { verifyAgentCard, type VerificationKey } from '../security/AgentCardSigner.js';
import { createEventSourceReader } from './eventSourceReader.js';
import {
  createDefaultClientOutboundPolicy,
  createOutboundPolicyFetch,
  type OutboundPolicyOptions,
} from '../net/OutboundPolicy.js';

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
}

interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;
  retryOn: number[];
}

export type A2AOfficialProtocolVersion = '1.0';
export type A2AExperimentalProtocolVersion = '1.2';
export type A2AProtocolVersion = A2AOfficialProtocolVersion | A2AExperimentalProtocolVersion;

const A2A_VERSION_HEADER = 'A2A-Version';

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
    this.protocolVersion = A2AClient.getProtocolPreferences(options)[0] ?? '1.0';
  }

  static async connect(agentCardUrl: string, options: A2AClientOptions = {}): Promise<A2AClient> {
    const fetchImplementation =
      options.fetchImplementation ??
      createOutboundPolicyFetch(
        options.outboundPolicy ?? createDefaultClientOutboundPolicy(agentCardUrl),
      );
    const response = await fetchImplementation(agentCardUrl, {
      headers: A2AClient.createProtocolHeaders(options),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Failed to resolve agent card from ${agentCardUrl}`);
    }

    const card = (await response.json()) as AgentCard;
    await A2AClient.verifyResolvedCard(card, options);
    const selectedInterface = A2AClient.selectInterface(card, options) ?? {
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
    const canonicalUrl = new URL(this.cardPath, this.baseUrl).toString();
    const legacyUrl = new URL('/.well-known/agent.json', this.baseUrl).toString();

    const response = await this.fetchWithRetry(canonicalUrl, {
      headers: this.createProtocolHeaders(),
    });
    if (response.ok) {
      const card = (await response.json()) as AgentCard;
      await this.verifyAgentCard(card);
      return card;
    }

    await response.body?.cancel().catch(() => undefined);

    const legacyResponse = await this.fetchWithRetry(legacyUrl, {
      headers: this.createProtocolHeaders(),
    });
    if (!legacyResponse.ok) {
      await legacyResponse.body?.cancel().catch(() => undefined);
      throw new Error(`Failed to resolve agent card from ${canonicalUrl}`);
    }

    const card = (await legacyResponse.json()) as AgentCard;
    await this.verifyAgentCard(card);
    return card;
  }

  private static isExperimentalProtocolVersion(
    version: A2AProtocolVersion,
  ): version is A2AExperimentalProtocolVersion {
    const experimentalVersions: readonly A2AProtocolVersion[] =
      A2AClient.experimentalProtocolVersions;
    return experimentalVersions.includes(version);
  }

  private static getProtocolPreferences(options: A2AClientOptions): readonly A2AProtocolVersion[] {
    const officialVersions: readonly A2AProtocolVersion[] = A2AClient.supportedVersions;
    const experimentalVersions: readonly A2AProtocolVersion[] =
      options.allowExperimentalProtocolVersions ? A2AClient.experimentalProtocolVersions : [];
    const preferences = [...officialVersions, ...experimentalVersions];

    if (!options.preferredProtocolVersion) {
      return preferences;
    }

    if (
      A2AClient.isExperimentalProtocolVersion(options.preferredProtocolVersion) &&
      !options.allowExperimentalProtocolVersions
    ) {
      throw new Error(
        'Protocol version 1.2 is an a2amesh experimental profile. Set allowExperimentalProtocolVersions to true to opt in.',
      );
    }

    if (!preferences.includes(options.preferredProtocolVersion)) {
      throw new Error(
        `Unsupported preferred protocol version: ${options.preferredProtocolVersion}`,
      );
    }

    return [
      options.preferredProtocolVersion,
      ...preferences.filter((version) => version !== options.preferredProtocolVersion),
    ];
  }

  private static selectInterface(
    card: AgentCard,
    options: A2AClientOptions,
  ): SupportedInterface | undefined {
    const interfaces = card.supportedInterfaces ?? [];

    for (const protocolVersion of A2AClient.getProtocolPreferences(options)) {
      const selectedInterface = interfaces.find((item) => item.protocolVersion === protocolVersion);
      if (selectedInterface) {
        return selectedInterface;
      }
    }

    return undefined;
  }

  async sendMessage(params: Message | MessageSendParams): Promise<Task> {
    return this.rpc<Task, MessageSendParams>('message/send', this.normalizeParams(params));
  }

  async sendMessageStream(params: Message | MessageSendParams): Promise<AsyncGenerator<unknown>> {
    return this.streamRpc<Task, MessageSendParams>('message/stream', this.normalizeParams(params));
  }

  subscribeTask(taskId: string): AsyncGenerator<unknown> {
    return this.subscribeToTask(taskId);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.rpc<Task, { taskId: string }>('tasks/get', { taskId });
  }

  async listTasks(params: TaskListParams = {}): Promise<TaskListResult> {
    return this.rpc<TaskListResult, TaskListParams>('tasks/list', params);
  }

  async cancelTask(taskId: string): Promise<Task> {
    return this.rpc<Task, { taskId: string }>('tasks/cancel', { taskId });
  }

  async setPushNotification(
    taskId: string,
    pushNotificationConfig: PushNotificationConfig,
  ): Promise<PushNotificationConfig> {
    return this.rpc<
      PushNotificationConfig,
      { taskId: string; pushNotificationConfig: PushNotificationConfig }
    >('tasks/pushNotification/set', {
      taskId,
      pushNotificationConfig,
    });
  }

  async getPushNotification(taskId: string): Promise<PushNotificationConfig | null> {
    return this.rpc<PushNotificationConfig | null, { taskId: string }>(
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
    return this.rpc<
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
    return this.rpc<PushNotificationConfig | null, { taskId: string; configId: string }>(
      'tasks/pushNotificationConfig/get',
      { taskId, configId },
    );
  }

  async listPushNotificationConfigs(
    taskId: string,
  ): Promise<{ configs: PushNotificationConfig[] }> {
    return this.rpc<{ configs: PushNotificationConfig[] }, { taskId: string }>(
      'tasks/pushNotificationConfig/list',
      { taskId },
    );
  }

  async deletePushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<{ deleted: boolean }> {
    return this.rpc<{ deleted: boolean }, { taskId: string; configId: string }>(
      'tasks/pushNotificationConfig/delete',
      { taskId, configId },
    );
  }

  async getAuthenticatedExtendedCard(): Promise<AgentCard> {
    return this.rpc<AgentCard, Record<string, never>>('agent/getAuthenticatedExtendedCard', {});
  }

  async authenticatedExtendedCard(): Promise<AgentCard> {
    return this.rpc<AgentCard, Record<string, never>>('agent/authenticatedExtendedCard', {});
  }

  async health(): Promise<A2AHealthResponse> {
    const response = await this.fetchWithRetry(new URL('/health', this.baseUrl), {
      headers: this.createProtocolHeaders(),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Health check failed with status ${response.status}`);
    }
    return (await response.json()) as A2AHealthResponse;
  }

  private async executeRpcRequest<TParams extends object>(
    method: string,
    params: TParams,
    streamMode: boolean,
  ): Promise<[Response, string]> {
    const options: ClientCallOptions = { headers: { ...this.headers } };
    const id = this.createRequestId();
    const payload = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params,
    };

    for (const interceptor of this.interceptors) {
      await interceptor.before({ method, body: payload, options });
    }

    const headers = this.injectTraceHeaders({
      ...(streamMode ? { Accept: 'text/event-stream' } : {}),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      ...(options.serviceParameters ?? {}),
      [A2A_VERSION_HEADER]: this.protocolVersion,
    });

    const response = await this.fetchWithRetry(new URL(this.rpcPath, this.baseUrl), {
      method: 'POST',
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
      body: JSON.stringify(payload),
    });

    return [response, id];
  }

  private async handleRpcResponse<T>(json: JsonRpcResponse<T>, method: string): Promise<T> {
    if ('error' in json) {
      const failure = json as JsonRpcFailureResponse;
      throw new Error(`${failure.error.message} (${failure.error.code})`);
    }

    const success = json as JsonRpcSuccessResponse<T>;
    for (const interceptor of this.interceptors) {
      await interceptor.after?.({ method, response: success.result } satisfies AfterArgs<T>);
    }
    return success.result;
  }

  private async rpc<T, TParams extends object>(method: string, params: TParams): Promise<T> {
    const [response] = await this.executeRpcRequest(method, params, false);

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`RPC request failed with status ${response.status}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;
    return this.handleRpcResponse(json, method);
  }

  private async *streamRpc<T, TParams extends object>(
    method: string,
    params: TParams,
  ): AsyncGenerator<T> {
    const [response] = await this.executeRpcRequest(method, params, true);

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`RPC stream failed with status ${response.status}`);
    }

    if (!response.body) {
      throw new Error('RPC stream response did not include a readable body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const result = await this.parseJsonRpcSseEvent<T>(rawEvent, method);
          if (result !== undefined) {
            yield result;
          }
          boundary = buffer.indexOf('\n\n');
        }

        if (done) {
          const result = await this.parseJsonRpcSseEvent<T>(buffer, method);
          if (result !== undefined) {
            yield result;
          }
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseSseData(rawEvent: string): string {
    return rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
  }

  private async parseJsonRpcSseEvent<T>(rawEvent: string, method: string): Promise<T | undefined> {
    const data = this.parseSseData(rawEvent);
    if (!data) {
      return undefined;
    }

    let json: JsonRpcResponse<T>;
    try {
      json = JSON.parse(data) as JsonRpcResponse<T>;
    } catch (error) {
      throw new Error(`RPC stream returned malformed JSON: ${String(error)}`, {
        cause: error,
      });
    }

    return this.handleRpcResponse(json, method);
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

  private createRequestId(): string {
    return globalThis.crypto.randomUUID();
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
          for (const [key, value] of Object.entries(this.createProtocolHeaders())) {
            headers.set(key, value);
          }

          return this.fetchImplementation(input, { ...init, headers });
        },
      };
      return eventSourceInit;
    }

    if (hasHeaders) {
      return { headers: this.createProtocolHeaders() };
    }

    return undefined;
  }

  private async verifyAgentCard(card: AgentCard): Promise<void> {
    await A2AClient.verifyResolvedCard(card, {
      trustedVerificationKeys: this.trustedVerificationKeys,
      requireVerifiedAgentCard: this.requireVerifiedAgentCard,
    });
  }

  private static async verifyResolvedCard(
    card: AgentCard,
    options: Pick<A2AClientOptions, 'trustedVerificationKeys' | 'requireVerifiedAgentCard'>,
  ): Promise<void> {
    const trustedVerificationKeys = options.trustedVerificationKeys ?? [];
    if (trustedVerificationKeys.length === 0 && !options.requireVerifiedAgentCard) {
      return;
    }

    const verification = await verifyAgentCard(card, trustedVerificationKeys);
    if (!verification.valid) {
      throw new Error('Agent card signature verification failed');
    }
  }

  private createProtocolHeaders(
    headers: Record<string, string> = this.headers,
  ): Record<string, string> {
    return A2AClient.createProtocolHeaders({
      headers,
      preferredProtocolVersion: this.protocolVersion,
    });
  }

  private static createProtocolHeaders(
    options: Pick<A2AClientOptions, 'headers' | 'preferredProtocolVersion'> = {},
  ): Record<string, string> {
    return {
      ...(options.headers ?? {}),
      [A2A_VERSION_HEADER]: options.preferredProtocolVersion ?? '1.0',
    };
  }

  private injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
    propagation.inject(context.active(), headers, {
      set(carrier, key, value) {
        (carrier as Record<string, string>)[key] = value;
      },
    });
    return headers;
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
