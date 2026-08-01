import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JsonRpcError, ErrorCodes } from '@a2amesh/runtime';
import { WsClient } from '../src/WsClient.js';
import { WsServer } from '../src/WsServer.js';

describe('WsServer + WsClient', () => {
  let server: WsServer;
  let port: number;

  beforeAll(async () => {
    server = new WsServer({
      async handleRequest(request) {
        if (request.method === 'ping') {
          return { pong: true };
        }

        throw new JsonRpcError(ErrorCodes.MethodNotFound, 'Unknown method');
      },
    });

    port = await server.start();
  });

  afterAll(async () => {
    await server.close();
  });

  it('sends a request and receives a response', async () => {
    const client = new WsClient(`ws://127.0.0.1:${port}/a2amesh-ws`);
    await client.connect();

    const result = await client.request<{ pong: boolean }>('ping', {});

    expect(result).toEqual({ pong: true });
    await client.close();
  });

  it('returns an error for unknown methods', async () => {
    const client = new WsClient(`ws://127.0.0.1:${port}/a2amesh-ws`);
    await client.connect();

    await expect(client.request('unknown', {})).rejects.toThrow('Unknown method');
    await client.close();
  });

  it('closes connections that request an unsupported A2A protocol version', async () => {
    const { default: WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/a2amesh-ws?A2A-Version=9.9`);

    const [code, reason] = (await once(socket, 'close')) as [number, Buffer];

    expect(code).toBe(1008);
    expect(reason.toString()).toContain('A2A protocol version is not supported');
  });
});

describe('WsServer streaming and authentication', () => {
  it('delivers same-id stream frames and completes the client iterator', async () => {
    const streamServer = new WsServer({
      async handleRequest() {
        throw new JsonRpcError(ErrorCodes.MethodNotFound, 'Unary method not available');
      },
      async *handleStream(request) {
        expect(request.method).toBe('message/stream');
        yield { sequence: 1 };
        yield { sequence: 2 };
      },
    });
    const streamPort = await streamServer.start();
    const client = new WsClient(`ws://127.0.0.1:${streamPort}/a2amesh-ws`);

    try {
      const received: Array<{ sequence: number }> = [];
      for await (const update of client.streamRequest<{ sequence: number }>('message/stream', {})) {
        received.push(update);
      }
      expect(received).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    } finally {
      await client.close();
      await streamServer.close();
    }
  });

  it('propagates stream errors and removes the pending iterator', async () => {
    const streamServer = new WsServer({
      async handleRequest() {
        throw new JsonRpcError(ErrorCodes.MethodNotFound, 'Unary method not available');
      },
      async *handleStream() {
        yield { sequence: 1 };
        throw new JsonRpcError(ErrorCodes.InternalError, 'Stream failed safely');
      },
    });
    const streamPort = await streamServer.start();
    const client = new WsClient(`ws://127.0.0.1:${streamPort}/a2amesh-ws`);

    try {
      const stream = client.streamRequest<{ sequence: number }>('message/stream', {});
      const iterator = stream[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { sequence: 1 } });
      await expect(iterator.next()).rejects.toThrow('Stream failed safely');
      expect(
        (client as unknown as { pendingStreams: Map<string, unknown> }).pendingStreams.size,
      ).toBe(0);
    } finally {
      await client.close();
      await streamServer.close();
    }
  });

  it('passes configured headers to the authentication hook and rejects missing credentials', async () => {
    const authServer = new WsServer({
      authenticate(request) {
        return request.headers.authorization === 'Bearer contract-token';
      },
      async handleRequest() {
        return { accepted: true };
      },
    });
    const authPort = await authServer.start();
    const url = `ws://127.0.0.1:${authPort}/a2amesh-ws`;
    const authenticated = new WsClient(url, {
      headers: { authorization: 'Bearer contract-token' },
    });
    const anonymous = new WsClient(url);

    try {
      await expect(authenticated.request('ping')).resolves.toEqual({ accepted: true });
      await expect(anonymous.request('ping')).rejects.toThrow(/unauthorized|closed/i);
    } finally {
      await authenticated.close();
      await anonymous.close();
      await authServer.close();
    }
  });
});
