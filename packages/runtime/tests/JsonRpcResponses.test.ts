import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyOwnershipError,
  InMemoryIdempotencyStore,
  type IdempotencyCompletedRecord,
  type IdempotencyFailedRecord,
  type IdempotencyStoredResult,
} from '../src/server/IdempotencyStore.js';
import type { IdempotencyResolution } from '../src/server/http/idempotency.js';
import {
  createJsonRpcErrorResponse,
  createJsonRpcSuccessResponse,
  writeJsonRpcErrorResponse,
} from '../src/server/http/jsonRpcResponses.js';
import { ErrorCodes, JsonRpcError } from '../src/types/jsonrpc.js';

function requestWithId(id: unknown): Request {
  return { body: { id } } as Request;
}

function responseRecorder(): { response: Response; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  return { response: { json } as unknown as Response, json };
}

async function acquire(
  store: InMemoryIdempotencyStore,
  overrides: Partial<IdempotencyResolution> = {},
): Promise<IdempotencyResolution> {
  const scope = overrides.scope ?? 'rpc:message/send:tenant-a:principal-a:apiKey';
  const key = overrides.key ?? 'key-a';
  const fingerprint = overrides.fingerprint ?? 'fingerprint-a';
  const reservation = await store.reserve(scope, key, fingerprint, 1_000);
  if (reservation.record.state !== 'in-flight') {
    throw new Error('Expected an in-flight reservation');
  }
  return {
    scope,
    key,
    fingerprint,
    ownerId: reservation.record.ownerId,
    leaseMs: 1_000,
    ...overrides,
  };
}

describe('JSON-RPC response writing', () => {
  it('builds success and failure envelopes while preserving valid ids', () => {
    expect(createJsonRpcSuccessResponse({ ok: true }, 0)).toEqual({
      jsonrpc: '2.0',
      result: { ok: true },
      id: 0,
    });
    expect(
      createJsonRpcErrorResponse(
        new JsonRpcError(ErrorCodes.InvalidParams, 'Invalid params', { field: 'message' }),
        '',
      ),
    ).toEqual({
      jsonrpc: '2.0',
      error: {
        code: ErrorCodes.InvalidParams,
        message: 'Invalid params',
        data: [
          expect.objectContaining({
            reason: 'INVALID_PARAMETERS',
            metadata: { field: 'message' },
          }),
        ],
      },
      id: '',
    });
  });

  it('finalizes protocol errors before writing the original response', async () => {
    const store = new InMemoryIdempotencyStore();
    const resolution = await acquire(store);
    const { response, json } = responseRecorder();
    const error = new JsonRpcError(ErrorCodes.InvalidParams, 'Invalid params', {
      field: 'message',
    });

    await writeJsonRpcErrorResponse(requestWithId('protocol'), response, error, resolution, {
      store,
      ttlMs: 60_000,
    });

    expect(await store.get(resolution.scope, resolution.key)).toMatchObject({
      state: 'failed',
      result: {
        kind: 'error',
        error: { code: ErrorCodes.InvalidParams, message: 'Invalid params' },
      },
    });
    expect(json).toHaveBeenCalledWith(createJsonRpcErrorResponse(error, 'protocol'));
  });

  it('does not finalize conflict or in-progress protocol errors', async () => {
    const store = new InMemoryIdempotencyStore();
    const complete = vi.spyOn(store, 'complete');
    const resolution = await acquire(store);

    for (const code of [ErrorCodes.IdempotencyConflict, ErrorCodes.IdempotencyInProgress]) {
      const { response, json } = responseRecorder();
      const error = new JsonRpcError(code, 'Reservation error');
      await writeJsonRpcErrorResponse(requestWithId(code), response, error, resolution, {
        store,
        ttlMs: 60_000,
      });
      expect(json).toHaveBeenCalledWith(createJsonRpcErrorResponse(error, code));
    }

    expect(complete).not.toHaveBeenCalled();
  });

  it('fails closed when protocol-error completion loses ownership', async () => {
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

    const store = new FailingCompleteStore();
    const resolution = await acquire(store);
    const { response, json } = responseRecorder();

    await writeJsonRpcErrorResponse(
      requestWithId('lost-owner'),
      response,
      new JsonRpcError(ErrorCodes.InvalidParams, 'Invalid params'),
      resolution,
      { store, ttlMs: 60_000 },
    );

    expect(json).toHaveBeenCalledWith(
      createJsonRpcErrorResponse(
        new JsonRpcError(ErrorCodes.InternalError, 'Internal Error'),
        'lost-owner',
      ),
    );
  });

  it('releases retryable reservations and returns a bounded internal error', async () => {
    const store = new InMemoryIdempotencyStore();
    const resolution = await acquire(store);
    const release = vi.spyOn(store, 'release');
    const { response, json } = responseRecorder();

    await writeJsonRpcErrorResponse(
      requestWithId('internal'),
      response,
      new Error('sensitive upstream detail'),
      resolution,
      { store, ttlMs: 60_000 },
    );

    expect(release).toHaveBeenCalledWith(resolution.scope, resolution.key, resolution.ownerId);
    expect(await store.get(resolution.scope, resolution.key)).toBeNull();
    expect(json).toHaveBeenCalledWith(
      createJsonRpcErrorResponse(
        new JsonRpcError(ErrorCodes.InternalError, 'Internal Error'),
        'internal',
      ),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain('sensitive upstream detail');
  });
});
