import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { A2AServer, type A2AServerOptions } from '../src/server/A2AServer.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';
import type { AgentCard } from '../src/types/agent-card.js';
import type { Artifact, Message, Task } from '../src/types/task.js';

const agentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'JSON-RPC Input Limit Harness',
  description: 'Input budget test harness',
  url: 'http://localhost:0',
  version: '1.0.0',
};

class InputLimitServer extends A2AServer {
  constructor(options: A2AServerOptions = {}) {
    super(agentCard, options);
  }

  async handleTask(_task: Task, _message: Message): Promise<Artifact[]> {
    return [];
  }
}

function optionsWithLimits(maxDepth: number, maxCollectionEntries: number): A2AServerOptions {
  return {
    jsonRpcInputLimits: { maxDepth, maxCollectionEntries },
  } as A2AServerOptions;
}

function expectInputLimitError(
  response: request.Response,
  expected: { limit: 'depth' | 'collection'; maximum: number; actual: number; id: unknown },
): void {
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    jsonrpc: '2.0',
    error: {
      code: ErrorCodes.InvalidRequest,
      message: 'JSON-RPC request exceeds input limits',
      data: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'INVALID_REQUEST',
          domain: 'a2a-protocol.org',
          metadata: {
            limit: expected.limit,
            maximum: String(expected.maximum),
            actual: String(expected.actual),
          },
        },
      ],
    },
    id: expected.id,
  });
  expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|\.ts:/i);
}

describe('JSON-RPC input limits', () => {
  it('enforces the default nesting depth budget', async () => {
    const server = new InputLimitServer();
    let nested: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 32; depth += 1) nested = { next: nested };

    const response = await request(server.getExpressApp()).post('/rpc').send({
      jsonrpc: '2.0',
      id: 'default-depth',
      method: 'tasks/list',
      params: nested,
    });

    expectInputLimitError(response, {
      limit: 'depth',
      maximum: 32,
      actual: 33,
      id: 'default-depth',
    });
  });

  it('enforces the default per-collection entry budget', async () => {
    const server = new InputLimitServer();
    const params = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [`key-${index}`, index]),
    );

    const response = await request(server.getExpressApp()).post('/rpc').send({
      jsonrpc: '2.0',
      id: 'default-collection',
      method: 'tasks/list',
      params,
    });

    expectInputLimitError(response, {
      limit: 'collection',
      maximum: 1000,
      actual: 1001,
      id: 'default-collection',
    });
  });
  it('rejects requests whose object graph exceeds the configured nesting depth', async () => {
    const server = new InputLimitServer(optionsWithLimits(3, 100));
    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'too-deep',
        method: 'tasks/list',
        params: { a: { b: { c: { d: true } } } },
      });

    expectInputLimitError(response, {
      limit: 'depth',
      maximum: 3,
      actual: 4,
      id: 'too-deep',
    });
  });

  it('rejects requests whose arrays or objects exceed the configured collection size', async () => {
    const server = new InputLimitServer(optionsWithLimits(10, 4));
    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'too-wide',
        method: 'tasks/list',
        params: { a: 1, b: 2, c: 3, d: 4, e: 5 },
      });

    expectInputLimitError(response, {
      limit: 'collection',
      maximum: 4,
      actual: 5,
      id: 'too-wide',
    });
  });

  it('accepts requests exactly on the configured depth and collection boundaries', async () => {
    const server = new InputLimitServer(optionsWithLimits(3, 4));
    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'at-boundary',
        method: 'tasks/list',
        params: { contextId: 'context-1', extra: { nested: true } },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'at-boundary',
      result: { tasks: [], total: 0 },
    });
  });
});
