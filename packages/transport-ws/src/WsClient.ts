import { randomUUID } from 'node:crypto';
import type {
  A2AHealthResponse,
  AgentCard,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
  TaskListParams,
  TaskListResult,
} from '@a2amesh/runtime';
import { JsonRpcError } from '@a2amesh/runtime';
import type WebSocket from 'ws';

interface JsonRpcSuccess<TResult> {
  jsonrpc: '2.0';
  id: string;
  result: TResult;
}

interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcStreamNext<TResult> {
  jsonrpc: '2.0';
  id: string;
  stream: 'next';
  result: TResult;
}

interface JsonRpcStreamComplete {
  jsonrpc: '2.0';
  id: string;
  stream: 'complete';
}

interface JsonRpcStreamError extends JsonRpcFailure {
  id: string;
  stream: 'error';
}

type JsonRpcResponse<TResult> = JsonRpcSuccess<TResult> | JsonRpcFailure;
type JsonRpcStreamResponse<TResult> =
  | JsonRpcStreamNext<TResult>
  | JsonRpcStreamComplete
  | JsonRpcStreamError;
type IncomingJsonRpcMessage = JsonRpcResponse<unknown> | JsonRpcStreamResponse<unknown>;

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

interface PendingStream<TResult> {
  method: string;
  queue: TResult[];
  done: boolean;
  error?: unknown;
  wake: (() => void) | undefined;
  timeout?: NodeJS.Timeout;
}

export interface WsClientOptions {
  protocols?: string | string[];
  protocolVersion?: string;
  requestTimeoutMs?: number;
  headers?: Record<string, string>;
}

async function loadWebSocket(): Promise<typeof WebSocket> {
  const module = await import('ws');
  return module.default;
}

function isErrorResponse(value: IncomingJsonRpcMessage): value is JsonRpcFailure {
  return 'error' in value;
}

function isStreamResponse(value: IncomingJsonRpcMessage): value is JsonRpcStreamResponse<unknown> {
  return 'stream' in value;
}

function createMessageParams(
  message: Message,
  options: Omit<MessageSendParams, 'message'> = {},
): MessageSendParams {
  return { message, ...options };
}

export class WsClient {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private readonly pendingStreams = new Map<string, PendingStream<unknown>>();

  constructor(
    private readonly url: string,
    private readonly options: WsClientOptions = {},
  ) {}

  private connectionUrl(): string {
    if (!this.options.protocolVersion) {
      return this.url;
    }

    const url = new URL(this.url);
    url.searchParams.set('A2A-Version', this.options.protocolVersion);
    return url.toString();
  }

  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      return;
    }

    const WebSocketCtor = await loadWebSocket();

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocketCtor(this.connectionUrl(), this.options.protocols, {
        ...(this.options.headers ? { headers: this.options.headers } : {}),
      });
      const handleOpen = () => {
        cleanup();
        this.socket = socket;
        socket.on('message', (payload) => {
          this.handleMessage(String(payload));
        });
        socket.on('close', (_code, reason) => {
          const detail = reason.toString().trim();
          this.rejectPending(
            new Error(
              detail ? `WebSocket connection closed: ${detail}` : 'WebSocket connection closed',
            ),
          );
          this.socket = undefined;
        });
        resolve();
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('open', handleOpen);
        socket.off('error', handleError);
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
    });
  }

  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    if (socket.readyState === socket.CLOSED) {
      this.socket = undefined;
      return;
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    await this.connect();

    const socket = this.socket;
    if (!socket) {
      throw new Error('WebSocket connection is not available');
    }

    const id = randomUUID();
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} response`));
      }, this.options.requestTimeoutMs ?? 10_000);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeout,
      });

      socket.send(payload, (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(id);
          }
          reject(this.normalizeSendError(socket, error));
        }
      });
    });
  }

  async *streamRequest<TResult>(method: string, params?: unknown): AsyncGenerator<TResult> {
    await this.connect();

    const socket = this.socket;
    if (!socket) {
      throw new Error('WebSocket connection is not available');
    }

    const id = randomUUID();
    const state: PendingStream<TResult> = {
      method,
      queue: [],
      done: false,
      wake: undefined,
    };
    this.pendingStreams.set(id, state as PendingStream<unknown>);
    this.armStreamTimeout(id, state);

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    socket.send(payload, (error) => {
      if (!error) {
        return;
      }
      state.error = this.normalizeSendError(socket, error);
      state.done = true;
      this.notifyStream(state);
    });

    try {
      while (true) {
        const value = state.queue.shift();
        if (value !== undefined) {
          yield value;
          continue;
        }

        if (state.error) {
          throw state.error;
        }
        if (state.done) {
          return;
        }

        await new Promise<void>((resolve) => {
          state.wake = resolve;
        });
      }
    } finally {
      if (state.timeout) {
        clearTimeout(state.timeout);
      }
      this.pendingStreams.delete(id);
    }
  }

  async sendMessage(
    message: Message,
    options: Omit<MessageSendParams, 'message'> = {},
  ): Promise<Task> {
    return this.request<Task>('message/send', createMessageParams(message, options));
  }

  streamMessage(
    message: Message,
    options: Omit<MessageSendParams, 'message'> = {},
  ): AsyncGenerator<Task> {
    return this.streamRequest<Task>('message/stream', createMessageParams(message, options));
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>('tasks/get', { taskId });
  }

  async listTasks(params: TaskListParams = {}): Promise<TaskListResult> {
    return this.request<TaskListResult>('tasks/list', params);
  }

  async cancelTask(taskId: string): Promise<Task> {
    return this.request<Task>('tasks/cancel', { taskId });
  }

  subscribeTask(taskId: string): AsyncGenerator<Task> {
    return this.streamRequest<Task>('tasks/resubscribe', { taskId });
  }

  async createPushNotificationConfig(
    taskId: string,
    pushNotificationConfig: PushNotificationConfig,
    configId = pushNotificationConfig.id,
  ): Promise<PushNotificationConfig> {
    return this.request<PushNotificationConfig>('tasks/pushNotificationConfig/create', {
      taskId,
      pushNotificationConfig,
      ...(configId ? { configId } : {}),
    });
  }

  async getPushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<PushNotificationConfig | null> {
    return this.request<PushNotificationConfig | null>('tasks/pushNotificationConfig/get', {
      taskId,
      configId,
    });
  }

  async listPushNotificationConfigs(
    taskId: string,
  ): Promise<{ configs: PushNotificationConfig[] }> {
    return this.request<{ configs: PushNotificationConfig[] }>(
      'tasks/pushNotificationConfig/list',
      { taskId },
    );
  }

  async deletePushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>('tasks/pushNotificationConfig/delete', {
      taskId,
      configId,
    });
  }

  async getAgentCard(): Promise<AgentCard> {
    return this.request<AgentCard>('agent/card');
  }

  async getAuthenticatedExtendedCard(): Promise<AgentCard> {
    return this.request<AgentCard>('agent/getAuthenticatedExtendedCard', {});
  }

  async health(): Promise<A2AHealthResponse | Record<string, unknown>> {
    return this.request<A2AHealthResponse | Record<string, unknown>>('health');
  }

  private handleMessage(payload: string): void {
    let parsed: IncomingJsonRpcMessage;
    try {
      parsed = JSON.parse(payload) as IncomingJsonRpcMessage;
    } catch {
      return;
    }

    const responseId = parsed.id;
    if (typeof responseId !== 'string') {
      return;
    }

    if (isStreamResponse(parsed)) {
      this.handleStreamMessage(responseId, parsed);
      return;
    }

    const pending = this.pending.get(responseId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(responseId);

    if (isErrorResponse(parsed)) {
      pending.reject(new JsonRpcError(parsed.error.code, parsed.error.message, parsed.error.data));
      return;
    }

    pending.resolve(parsed.result);
  }

  private handleStreamMessage(id: string, parsed: JsonRpcStreamResponse<unknown>): void {
    const state = this.pendingStreams.get(id);
    if (!state) {
      return;
    }

    this.armStreamTimeout(id, state);

    if (parsed.stream === 'next') {
      state.queue.push(parsed.result);
    } else if (parsed.stream === 'error') {
      state.error = new JsonRpcError(parsed.error.code, parsed.error.message, parsed.error.data);
      state.done = true;
    } else {
      state.done = true;
    }

    this.notifyStream(state);
  }

  private armStreamTimeout(id: string, state: PendingStream<unknown>): void {
    if (state.timeout) {
      clearTimeout(state.timeout);
    }
    state.timeout = setTimeout(() => {
      state.error = new Error(`Timed out waiting for ${state.method} stream response`);
      state.done = true;
      this.pendingStreams.delete(id);
      this.notifyStream(state);
    }, this.options.requestTimeoutMs ?? 10_000);
  }

  private normalizeSendError(socket: WebSocket, error: Error): Error {
    if (socket.readyState === socket.CLOSING || socket.readyState === socket.CLOSED) {
      return new Error('WebSocket connection closed');
    }
    return error;
  }

  private notifyStream(state: PendingStream<unknown>): void {
    const wake = state.wake;
    state.wake = undefined;
    wake?.();
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }

    for (const [id, state] of this.pendingStreams.entries()) {
      if (state.timeout) {
        clearTimeout(state.timeout);
      }
      state.error = error;
      state.done = true;
      this.pendingStreams.delete(id);
      this.notifyStream(state);
    }
  }
}
