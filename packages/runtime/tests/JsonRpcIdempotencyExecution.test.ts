import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeMetrics } from '../src/telemetry/RuntimeMetrics.js';
import {
  InMemoryIdempotencyStore,
  type IdempotencyStoredResult,
} from '../src/server/IdempotencyStore.js';
import { completeIdempotency } from '../src/server/http/idempotency.js';
import {
  executeJsonRpcIdempotentRequest,
  resolveJsonRpcExecutionIdempotency,
} from '../src/server/http/jsonRpcIdempotencyExecution.js';
import type { RequestContext } from '../src/types/auth.js';
import type { JsonRpcRequest } from '../src/types/jsonrpc.js';

function requestWithKey(key: string): Request {
  return {
    header: vi.fn((name: string) => (name.toLowerCase() === 'idempotency-key' ? key : undefined)),
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

function responseRecorder(): { response: Response; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  return { response: { json } as unknown as Response, json };
}

function requestContext(): RequestContext {
  return {
    requestId: 'request-1',
    authMethod: 'apiKey',
    principalId: 'principal-a',
    tenantId: 'tenant-a',
    scopes: [],
    roles: [],
    claims: {},
  };
}

function rpcRequest(method: string, id: string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: { value: 'same-payload' },
  };
}

function metrics(): RuntimeMetrics {
  return new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('JSON-RPC idempotency execution', () => {
  it('acquires, completes, decorates, and replays a successful request', async () => {
    const store = new InMemoryIdempotencyStore();
    const runtimeMetrics = metrics();
    const firstRequest = rpcRequest('message/send', 'first');
    const firstResponse = responseRecorder();
    const resolution = await resolveJsonRpcExecutionIdempotency(
      requestWithKey('success-key'),
      firstRequest,
      requestContext(),
      firstResponse.response,
      { store, leaseMs: 1_000, runtimeMetrics },
    );

    expect(resolution?.ownerId).toBeDefined();
    const execute = vi.fn().mockResolvedValue({ id: 'task-1', metadata: { source: 'test' } });
    const result = await executeJsonRpcIdempotentRequest(firstRequest, resolution, execute, {
      store,
      ttlMs: 60_000,
      runtimeMetrics,
    });

    expect(result).toEqual({
      id: 'task-1',
      metadata: {
        source: 'test',
        idempotency: {
          key: 'success-key',
          scope: resolution?.scope,
          fingerprint: resolution?.fingerprint,
          replayed: false,
        },
      },
    });
    expect(await store.get(resolution?.scope ?? '', 'success-key')).toMatchObject({
      state: 'completed',
      result: { kind: 'success', value: result } satisfies IdempotencyStoredResult,
    });

    const replayResponse = responseRecorder();
    await expect(
      resolveJsonRpcExecutionIdempotency(
        requestWithKey('success-key'),
        rpcRequest('message/send', 'replay'),
        requestContext(),
        replayResponse.response,
        { store, leaseMs: 1_000, runtimeMetrics },
      ),
    ).resolves.toBeNull();
    expect(replayResponse.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      result: {
        id: 'task-1',
        metadata: {
          source: 'test',
          idempotency: {
            key: 'success-key',
            scope: resolution?.scope,
            fingerprint: resolution?.fingerprint,
            replayed: true,
          },
        },
      },
      id: 'replay',
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('defers streaming replays to the streaming response transport', async () => {
    const store = new InMemoryIdempotencyStore();
    const runtimeMetrics = metrics();
    const streamRequest = rpcRequest('message/stream', 'first-stream');
    const acquired = await resolveJsonRpcExecutionIdempotency(
      requestWithKey('stream-key'),
      streamRequest,
      requestContext(),
      responseRecorder().response,
      { store, leaseMs: 1_000, runtimeMetrics },
    );
    expect(acquired?.ownerId).toBeDefined();
    if (!acquired) throw new Error('Expected an acquired idempotency reservation');
    await completeIdempotency(
      store,
      acquired,
      { kind: 'success', value: { id: 'stream-task' } },
      60_000,
    );

    const replayResponse = responseRecorder();
    const replay = await resolveJsonRpcExecutionIdempotency(
      requestWithKey('stream-key'),
      rpcRequest('message/stream', 'replay-stream'),
      requestContext(),
      replayResponse.response,
      { store, leaseMs: 1_000, runtimeMetrics },
    );

    expect(replay).toMatchObject({
      key: 'stream-key',
      replay: { kind: 'success', value: { id: 'stream-task' } },
    });
    expect(replayResponse.json).not.toHaveBeenCalled();
  });

  it('stops the renewal lease when execution rejects', async () => {
    vi.useFakeTimers();
    const store = new InMemoryIdempotencyStore();
    const renew = vi.spyOn(store, 'renew');
    const runtimeMetrics = metrics();
    const resolution = {
      scope: 'rpc:message/send:tenant-a:principal-a:apiKey',
      key: 'failure-key',
      fingerprint: 'fingerprint',
      ownerId: 'owner-1',
      leaseMs: 30,
    };

    await expect(
      executeJsonRpcIdempotentRequest(
        rpcRequest('message/send', 'failure'),
        resolution,
        async () => {
          throw new Error('transient failure');
        },
        { store, ttlMs: 60_000, runtimeMetrics },
      ),
    ).rejects.toThrow('transient failure');

    await vi.advanceTimersByTimeAsync(100);
    expect(renew).not.toHaveBeenCalled();
  });
});
