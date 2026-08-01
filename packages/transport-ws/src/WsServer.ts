import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { JsonRpcRequest } from '@a2amesh/runtime';
import { ErrorCodes, JsonRpcError } from '@a2amesh/runtime';
import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';

const A2A_VERSION_HEADER = 'a2a-version';
const SUPPORTED_A2A_PROTOCOL_VERSIONS = ['1.0', '1.2', '0.3'] as const;
const WS_POLICY_CLOSE_CODE = 1008;
const STREAMING_METHODS = new Set(['message/stream', 'tasks/resubscribe']);

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | null;
  stream?: 'next' | 'complete' | 'error';
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface WsServerOptions {
  host?: string;
  port?: number;
  path?: string;
  supportedProtocolVersions?: readonly string[];
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>;
  handleRequest: (request: JsonRpcRequest) => Promise<unknown>;
  handleStream?: (
    request: JsonRpcRequest,
  ) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>;
}

interface WsModule {
  WebSocketServer: typeof WebSocketServer;
}

async function loadWsModule(): Promise<WsModule> {
  const module = await import('ws');
  return {
    WebSocketServer: module.WebSocketServer,
  };
}

function createSuccessResponse(id: string | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function createStreamNextResponse(id: string, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    stream: 'next',
    result,
  };
}

function createStreamCompleteResponse(id: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    stream: 'complete',
  };
}

function createErrorResponse(
  id: string | null,
  error: JsonRpcError,
  stream?: 'error',
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    ...(stream ? { stream } : {}),
    error: {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    },
  };
}

function ensureJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (!value || typeof value !== 'object') {
    throw new JsonRpcError(ErrorCodes.InvalidRequest, 'Invalid JSON-RPC payload');
  }

  const request = value as Partial<JsonRpcRequest>;
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    throw new JsonRpcError(ErrorCodes.InvalidRequest, 'Invalid JSON-RPC envelope');
  }

  return {
    jsonrpc: '2.0',
    id: request.id ?? null,
    method: request.method,
    ...(request.params !== undefined ? { params: request.params } : {}),
  };
}

function publicJsonRpcError(error: unknown): JsonRpcError {
  return error instanceof JsonRpcError
    ? error
    : new JsonRpcError(ErrorCodes.InternalError, 'Internal Error');
}

export class WsServer {
  private readonly server: HttpServer;
  private websocketServer: WebSocketServer | undefined;

  constructor(private readonly options: WsServerOptions) {
    this.server = createServer();
  }

  async start(): Promise<number> {
    const { WebSocketServer } = await loadWsModule();
    this.websocketServer = new WebSocketServer({
      server: this.server,
      path: this.options.path ?? '/a2amesh-ws',
    });

    this.websocketServer.on('connection', (socket, request) => {
      void this.handleConnection(socket, request);
    });

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port ?? 0, this.options.host ?? '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (address && typeof address === 'object') {
      return address.port;
    }

    throw new Error('Unable to determine WebSocket server port');
  }

  private async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    if (!this.acceptsProtocolVersion(request)) {
      socket.close(WS_POLICY_CLOSE_CODE, 'A2A protocol version is not supported');
      return;
    }

    try {
      if (this.options.authenticate && !(await this.options.authenticate(request))) {
        socket.close(WS_POLICY_CLOSE_CODE, 'Unauthorized');
        return;
      }
    } catch {
      socket.close(WS_POLICY_CLOSE_CODE, 'Unauthorized');
      return;
    }

    socket.on('message', (payload) => {
      void this.handleSocketMessage(socket, String(payload));
    });
  }

  private acceptsProtocolVersion(request: IncomingMessage): boolean {
    const requestedVersion = this.getRequestedProtocolVersion(request);
    if (!requestedVersion) {
      return true;
    }

    return this.supportedProtocolVersions().includes(requestedVersion);
  }

  private getRequestedProtocolVersion(request: IncomingMessage): string | undefined {
    const headerValue = request.headers[A2A_VERSION_HEADER];
    if (Array.isArray(headerValue)) {
      return headerValue[0]?.trim();
    }
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      return headerValue.trim();
    }

    if (request.url) {
      const url = new URL(request.url, 'ws://localhost');
      return (
        url.searchParams.get('A2A-Version') ?? url.searchParams.get(A2A_VERSION_HEADER) ?? undefined
      );
    }

    return undefined;
  }

  private supportedProtocolVersions(): readonly string[] {
    return this.options.supportedProtocolVersions ?? SUPPORTED_A2A_PROTOCOL_VERSIONS;
  }

  async close(): Promise<void> {
    if (this.websocketServer) {
      await new Promise<void>((resolve, reject) => {
        this.websocketServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.websocketServer = undefined;
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleSocketMessage(socket: WebSocket, payload: string): Promise<void> {
    let requestId: string | null = null;

    try {
      const request = ensureJsonRpcRequest(JSON.parse(payload) as unknown);
      requestId = typeof request.id === 'string' ? request.id : null;
      if (STREAMING_METHODS.has(request.method)) {
        await this.handleSocketStream(socket, request, requestId);
        return;
      }

      const result = await this.options.handleRequest(request);
      this.send(socket, createSuccessResponse(requestId, result));
    } catch (error) {
      this.send(socket, createErrorResponse(requestId, publicJsonRpcError(error)));
    }
  }

  private async handleSocketStream(
    socket: WebSocket,
    request: JsonRpcRequest,
    requestId: string | null,
  ): Promise<void> {
    if (!requestId) {
      throw new JsonRpcError(ErrorCodes.InvalidRequest, 'Streaming requests require an id');
    }
    if (!this.options.handleStream) {
      throw new JsonRpcError(
        ErrorCodes.UnsupportedOperation,
        `${request.method} is not available on this WebSocket server`,
      );
    }

    try {
      const stream = await this.options.handleStream(request);
      for await (const update of stream) {
        this.send(socket, createStreamNextResponse(requestId, update));
      }
      this.send(socket, createStreamCompleteResponse(requestId));
    } catch (error) {
      this.send(socket, createErrorResponse(requestId, publicJsonRpcError(error), 'error'));
    }
  }

  private send(socket: WebSocket, response: JsonRpcResponse): void {
    if (socket.readyState !== 1) {
      return;
    }
    socket.send(JSON.stringify(response));
  }
}
