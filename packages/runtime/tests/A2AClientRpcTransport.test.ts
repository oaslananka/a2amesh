import { describe, expect, it, vi } from 'vitest';
import { createA2AClientRpcTransport } from '../src/client/A2AClientRpcTransport.js';

function createTask(id: string, state = 'WORKING') {
  return {
    id,
    status: { state, timestamp: '2026-07-31T00:00:00.000Z' },
    history: [],
  };
}

describe('A2A client RPC transport', () => {
  it('builds requests, applies interceptors, and normalizes successful responses', async () => {
    const before = vi.fn(async ({ options }) => {
      options.headers = { ...(options.headers ?? {}), authorization: 'Bearer token' };
      options.serviceParameters = { 'x-service-mode': 'fast' };
    });
    const after = vi.fn();
    const fetchWithRetry = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'response-id',
          result: createTask('task-1'),
        }),
        { status: 200 },
      ),
    );
    const transport = createA2AClientRpcTransport({
      baseUrl: 'https://agent.example',
      rpcPath: '/a2a/jsonrpc',
      protocolVersion: '1.0',
      jsonRpcDialect: 'mesh',
      headers: { 'x-client-id': 'client-1' },
      interceptors: [{ before, after }],
      fetchWithRetry,
    });

    await expect(transport.rpc('tasks/get', { taskId: 'task-1' })).resolves.toEqual(
      createTask('task-1'),
    );

    expect(fetchWithRetry).toHaveBeenCalledTimes(1);
    const [input, init] = fetchWithRetry.mock.calls[0] ?? [];
    expect(String(input)).toBe('https://agent.example/a2a/jsonrpc');
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'A2A-Version': '1.0',
        'Content-Type': 'application/json',
        'x-client-id': 'client-1',
        authorization: 'Bearer token',
        'x-service-mode': 'fast',
      }),
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'tasks/get',
      params: { taskId: 'task-1' },
    });
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith({ method: 'tasks/get', response: createTask('task-1') });
  });

  it('parses split CRLF SSE frames and reports each normalized result', async () => {
    const encoder = new TextEncoder();
    const first = JSON.stringify({
      jsonrpc: '2.0',
      id: 'stream-id',
      result: createTask('task-stream', 'WORKING'),
    });
    const second = JSON.stringify({
      jsonrpc: '2.0',
      id: 'stream-id',
      result: createTask('task-stream', 'COMPLETED'),
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: task\r\ndata: ${first.slice(0, 40)}`));
        controller.enqueue(
          encoder.encode(`${first.slice(40)}\r\n\r\nevent: task\r\ndata: ${second}\r\n\r\n`),
        );
        controller.close();
      },
    });
    const after = vi.fn();
    const fetchWithRetry = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );
    const transport = createA2AClientRpcTransport({
      baseUrl: 'https://agent.example',
      rpcPath: '/a2a/jsonrpc',
      protocolVersion: '1.0',
      jsonRpcDialect: 'mesh',
      headers: {},
      interceptors: [{ before: vi.fn(), after }],
      fetchWithRetry,
    });

    const states: string[] = [];
    for await (const task of transport.streamRpc<ReturnType<typeof createTask>, { taskId: string }>(
      'tasks/resubscribe',
      { taskId: 'task-stream' },
    )) {
      states.push(task.status.state);
    }

    expect(states).toEqual(['WORKING', 'COMPLETED']);
    expect(after).toHaveBeenCalledTimes(2);
    expect(fetchWithRetry).toHaveBeenCalledWith(
      new URL('https://agent.example/a2a/jsonrpc'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    );
  });

  it('rejects malformed JSON-RPC SSE payloads without leaking parser internals', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {not-json}\n\n'));
        controller.close();
      },
    });
    const transport = createA2AClientRpcTransport({
      baseUrl: 'https://agent.example',
      rpcPath: '/a2a/jsonrpc',
      protocolVersion: '1.0',
      jsonRpcDialect: 'mesh',
      headers: {},
      interceptors: [],
      fetchWithRetry: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(stream, { status: 200 })),
    });

    const updates = transport.streamRpc('message/stream', { message: {} });
    await expect(updates.next()).rejects.toThrow('RPC stream returned malformed JSON');
  });
});
