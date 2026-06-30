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
