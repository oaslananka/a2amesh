import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyOwnershipError,
  InMemoryIdempotencyStore,
  type IdempotencyCompletedRecord,
  type IdempotencyFailedRecord,
  type IdempotencyStoredResult,
} from '../src/server/IdempotencyStore.js';
import { createJsonRpcHttpHandler } from '../src/server/http/jsonRpcHandler.js';
import { RuntimeMetrics } from '../src/telemetry/RuntimeMetrics.js';
import { ErrorCodes, JsonRpcError } from '../src/types/jsonrpc.js';

function makeApp(options: { store?: InMemoryIdempotencyStore; handleRpc: () => Promise<unknown> }) {
  const app = express();
  app.use(express.json());
  app.post(
    '/rpc',
    createJsonRpcHttpHandler({
      authMiddleware: undefined,
      runtimeMetrics: new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' }),
      idempotencyStore: options.store ?? new InMemoryIdempotencyStore(),
      idempotencyTtlMs: 60_000,
      idempotencyLeaseMs: 1_000,
      handleRpc: options.handleRpc,
      handleStreamingRpc: vi.fn(async () => undefined),
    }),
  );
  return app;
}

const payload = {
  jsonrpc: '2.0' as const,
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      messageId: 'message-1',
      parts: [{ type: 'text', text: 'hello' }],
    },
  },
};

describe('idempotent JSON-RPC error handling', () => {
  it('releases reservations after retryable internal failures', async () => {
    const handleRpc = vi.fn(async () => {
      throw new Error('transient failure');
    });
    const app = makeApp({ handleRpc });

    const first = await request(app)
      .post('/rpc')
      .set('Idempotency-Key', 'retryable-key')
      .send({ ...payload, id: 'first' });
    const second = await request(app)
      .post('/rpc')
      .set('Idempotency-Key', 'retryable-key')
      .send({ ...payload, id: 'second' });

    expect(first.body.error).toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Internal Error',
    });
    expect(second.body.error).toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Internal Error',
    });
    expect(handleRpc).toHaveBeenCalledTimes(2);
  });

  it('stores protocol errors and replays them without redispatch', async () => {
    const handleRpc = vi.fn(async () => {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Invalid params', { field: 'message' });
    });
    const app = makeApp({ handleRpc });

    const first = await request(app)
      .post('/rpc')
      .set('Idempotency-Key', 'protocol-error-key')
      .send({ ...payload, id: 'first' });
    const replay = await request(app)
      .post('/rpc')
      .set('Idempotency-Key', 'protocol-error-key')
      .send({ ...payload, id: 'replay' });

    expect(first.body.error).toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'Invalid params',
    });
    expect(replay.body.error).toEqual(first.body.error);
    expect(replay.body.id).toBe('replay');
    expect(handleRpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a protocol error cannot be finalized', async () => {
    class FailingCompleteStore extends InMemoryIdempotencyStore {
      override async complete(
        _scope: string,
        _key: string,
        _ownerId: string,
        _result: IdempotencyStoredResult,
        _ttlMs: number,
      ): Promise<IdempotencyCompletedRecord | IdempotencyFailedRecord> {
        throw new IdempotencyOwnershipError('lost before completion');
      }
    }

    const app = makeApp({
      store: new FailingCompleteStore(),
      handleRpc: vi.fn(async () => {
        throw new JsonRpcError(ErrorCodes.InvalidParams, 'Invalid params');
      }),
    });

    const response = await request(app)
      .post('/rpc')
      .set('Idempotency-Key', 'lost-owner-key')
      .send({ ...payload, id: 'lost-owner' });

    expect(response.body.error).toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Internal Error',
    });
  });

  it('still returns a bounded error when reservation release fails', async () => {
    class FailingReleaseStore extends InMemoryIdempotencyStore {
      override async release(_scope: string, _key: string, _ownerId: string): Promise<boolean> {
        throw new Error('redis unavailable');
      }
    }

    const app = makeApp({
      store: new FailingReleaseStore(),
      handleRpc: vi.fn(async () => {
        throw new Error('transient failure');
      }),
    });

    const response = await request(app)
      .post('/rpc')
      .set('Idempotency-Key', 'release-failure-key')
      .send({ ...payload, id: 'release-failure' });

    expect(response.body.error).toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'Internal Error',
    });
  });
});
