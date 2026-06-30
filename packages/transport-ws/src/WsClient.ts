import { randomUUID } from 'node:crypto';
import type {
  Message,
  MessageSendParams,
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

type JsonRpcResponse<TResult> = JsonRpcSuccess<TResult> | JsonRpcFailure;

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

export interface WsClientOptions {
  protocols?: string | string[];
  protocolVersion?: string;
  requestTimeoutMs?: number;
}

async function loadWebSocket(): Promise<typeof WebSocket> {
  const module = await import('ws');
  return module.default;
}

function isErrorResponse<TResult>(value: JsonRpcResponse<TResult>): value is JsonRpcFailure {
  return 'error' in value;
}

function createMessageParams(message: Message): MessageSendParams {
  return { message };
}

export class WsClient {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest<unknown>>();

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
      const socket = new WebSocketCtor(this.connectionUrl(), this.options.protocols);
      const handleOpen = () => {
        cleanup();
        this.socket = socket;
        socket.on('message', (payload) => {
          this.handleMessage(String(payload));
        });
        socket.on('close', () => {
          this.rejectPending(new Error('WebSocket connection closed'));
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
      ...(params ? { params } : {}),
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
          reject(error);
        }
      });
    });
  }

  async sendMessage(message: Message): Promise<Task> {
    return this.request<Task>('message/send', createMessageParams(message));
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>('tasks/get', { taskId });
  }

  async listTasks(params: TaskListParams = {}): Promise<TaskListResult> {
    return this.request<TaskListResult>('tasks/list', params);
  }
  private handleMessage(payload: string): void {
    let parsed: JsonRpcResponse<unknown>;
    try {
      parsed = JSON.parse(payload) as JsonRpcResponse<unknown>;
    } catch {
      return;
    }

    const responseId = parsed.id;
    if (typeof responseId !== 'string') {
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
  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
