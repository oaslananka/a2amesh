import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { JsonRpcRequest } from '@a2amesh/runtime';
import { ErrorCodes, JsonRpcError } from '@a2amesh/runtime';
import type WebSocket from 'ws';
import type { WebSocketServer } from 'ws';

const A2A_VERSION_HEADER = 'a2a-version';
const SUPPORTED_A2A_PROTOCOL_VERSIONS = ['1.0', '1.2', '0.3'] as const;
const WS_UNSUPPORTED_PROTOCOL_CLOSE_CODE = 1008;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | null;
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
  handleRequest: (request: JsonRpcRequest) => Promise<unknown>;
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

function createErrorResponse(id: string | null, error: JsonRpcError): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
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
      if (!this.acceptsProtocolVersion(request)) {
        socket.close(WS_UNSUPPORTED_PROTOCOL_CLOSE_CODE, 'A2A protocol version is not supported');
        return;
      }

      socket.on('message', async (payload) => {
        await this.handleSocketMessage(socket, String(payload));
      });
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
      const result = await this.options.handleRequest(request);
      socket.send(JSON.stringify(createSuccessResponse(requestId, result)));
    } catch (error) {
      const rpcError =
        error instanceof JsonRpcError
          ? error
          : new JsonRpcError(ErrorCodes.InternalError, 'Internal Error');
      socket.send(JSON.stringify(createErrorResponse(requestId, rpcError)));
    }
  }
}
