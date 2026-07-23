import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { IdempotencyReservation, IdempotencyStore } from '../src/server/IdempotencyStore.js';
import {
  buildIdempotencyScope,
  decorateIdempotentResult,
  extractJsonRpcId,
  isIdempotentMethod,
  resolveIdempotency,
} from '../src/server/http/idempotency.js';
import { RuntimeMetrics } from '../src/telemetry/RuntimeMetrics.js';
import type { RequestContext } from '../src/types/auth.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';

const requestContext: RequestContext = {
  requestId: 'request-1',
  authMethod: 'apiKey',
  principalId: 'principal-1',
  tenantId: 'tenant-1',
  scopes: [],
  roles: [],
  claims: {},
};

function makeRequest(idempotencyKey?: string): Request {
  return {
    header: vi.fn((name: string) =>
      name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined,
    ),
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.11' },
  } as unknown as Request;
}

function makeResponse(): Response & { json: ReturnType<typeof vi.fn> } {
  return { json: vi.fn() } as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

function makeStore(reservation: IdempotencyReservation): IdempotencyStore {
  return {
    get: vi.fn(async () => null),
    reserve: vi.fn(async () => reservation),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => {
      throw new Error('not used');
    }),
    release: vi.fn(async () => true),
    set: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
}

function inFlightReservation(
  outcome: 'acquired' | 'recovered' | 'in-progress',
): IdempotencyReservation {
  return {
    outcome,
    record: {
      state: 'in-flight',
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      ownerId: 'owner-1',
      reservedAt: Date.now(),
      expiresAt: Date.now() + 1_000,
    },
  };
}

describe('idempotency HTTP resolution', () => {
  it('recognizes protected methods and skips requests without idempotency', async () => {
    expect(isIdempotentMethod('message/send')).toBe(true);
    expect(isIdempotentMethod('tasks/get')).toBe(false);
    expect(buildIdempotencyScope({ method: 'message/send', authMethod: 'anonymous' })).toBe(
      'rpc:message/send:global:anonymous:anonymous',
    );

    const response = makeResponse();
    await expect(
      resolveIdempotency(
        makeRequest('key'),
        { jsonrpc: '2.0', method: 'tasks/get' },
        requestContext,
        response,
        makeStore(inFlightReservation('acquired')),
      ),
    ).resolves.toBeUndefined();
    await expect(
      resolveIdempotency(
        makeRequest(),
        { jsonrpc: '2.0', method: 'message/send' },
        requestContext,
        response,
        makeStore(inFlightReservation('acquired')),
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects conflicting and concurrent reservations with bounded errors', async () => {
    const conflict = {
      outcome: 'conflict' as const,
      record: {
        state: 'completed' as const,
        scope: 'scope',
        key: 'key',
        fingerprint: 'other',
        storedAt: new Date().toISOString(),
        expiresAt: Date.now() + 1_000,
        result: { kind: 'success' as const, value: null },
      },
    };
    await expect(
      resolveIdempotency(
        makeRequest('key'),
        { jsonrpc: '2.0', id: 'conflict', method: 'message/send', params: { value: 1 } },
        requestContext,
        makeResponse(),
        makeStore(conflict),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.IdempotencyConflict });

    const inProgress = inFlightReservation('in-progress');
    inProgress.record.expiresAt = Date.now() - 1;
    await expect(
      resolveIdempotency(
        makeRequest('key'),
        { jsonrpc: '2.0', id: 'progress', method: 'message/send', params: { value: 1 } },
        requestContext,
        makeResponse(),
        makeStore(inProgress),
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.IdempotencyInProgress,
      data: [
        expect.objectContaining({
          metadata: { retryAfterMs: '0' },
          reason: 'IDEMPOTENCY_IN_PROGRESS',
        }),
      ],
    });
  });

  it('writes terminal replays and defers streaming replay responses', async () => {
    const failed = {
      outcome: 'replay' as const,
      record: {
        state: 'failed' as const,
        scope: 'scope',
        key: 'key',
        fingerprint: 'fingerprint',
        storedAt: new Date().toISOString(),
        expiresAt: Date.now() + 1_000,
        result: { kind: 'error' as const, error: { code: -32000, message: 'stored failure' } },
      },
    };
    const failedResponse = makeResponse();
    await expect(
      resolveIdempotency(
        makeRequest('key'),
        { jsonrpc: '2.0', id: 'failed', method: 'message/send', params: { value: 1 } },
        requestContext,
        failedResponse,
        makeStore(failed),
      ),
    ).resolves.toBeNull();
    expect(failedResponse.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'stored failure' },
      id: 'failed',
    });

    const completed = {
      outcome: 'replay' as const,
      record: {
        state: 'completed' as const,
        scope: 'scope',
        key: 'key',
        fingerprint: 'fingerprint',
        storedAt: new Date().toISOString(),
        expiresAt: Date.now() + 1_000,
        result: { kind: 'success' as const, value: { id: 'task-1' } },
      },
    };
    const deferred = await resolveIdempotency(
      makeRequest('key'),
      { jsonrpc: '2.0', id: 'completed', method: 'message/stream', params: { value: 1 } },
      requestContext,
      makeResponse(),
      makeStore(completed),
      { deferReplay: true },
    );
    expect(deferred).toMatchObject({ replay: completed.record.result });
  });

  it('returns owned and recovered reservations and records metrics', async () => {
    const metrics = new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' });
    const recovered = await resolveIdempotency(
      makeRequest('key'),
      { jsonrpc: '2.0', id: 'recovered', method: 'message/send', params: { value: 1 } },
      requestContext,
      makeResponse(),
      makeStore(inFlightReservation('recovered')),
      { leaseMs: 2_000, runtimeMetrics: metrics },
    );

    expect(recovered).toMatchObject({ ownerId: 'owner-1', leaseMs: 2_000 });
    expect(metrics.renderPrometheus(emptyTaskCounts())).toContain(
      'a2a_runtime_idempotency_total{service_name="test",service_version="1.0.0",outcome="recovered"} 1',
    );
  });

  it('fails closed when a store returns a terminal record as newly acquired', async () => {
    const invalid = {
      outcome: 'acquired',
      record: {
        state: 'completed',
        scope: 'scope',
        key: 'key',
        fingerprint: 'fingerprint',
        storedAt: new Date().toISOString(),
        expiresAt: Date.now() + 1_000,
        result: { kind: 'success', value: null },
      },
    } as unknown as IdempotencyReservation;

    await expect(
      resolveIdempotency(
        makeRequest('key'),
        { jsonrpc: '2.0', id: 'invalid', method: 'message/send' },
        requestContext,
        makeResponse(),
        makeStore(invalid),
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.InternalError });
  });

  it('decorates object results and extracts only valid JSON-RPC ids', () => {
    const resolution = { scope: 'scope', key: 'key', fingerprint: 'fingerprint' };
    expect(decorateIdempotentResult(null, resolution, false)).toBeNull();
    expect(decorateIdempotentResult(['value'], resolution, false)).toEqual(['value']);
    expect(
      decorateIdempotentResult({ metadata: { existing: true }, value: 1 }, resolution, true),
    ).toEqual({
      metadata: {
        existing: true,
        idempotency: { ...resolution, replayed: true },
      },
      value: 1,
    });

    expect(extractJsonRpcId(undefined)).toBeNull();
    expect(extractJsonRpcId({ id: 'request-1' })).toBe('request-1');
    expect(extractJsonRpcId({ id: 42 })).toBe(42);
    expect(extractJsonRpcId({ id: { invalid: true } })).toBeNull();
  });
});

function emptyTaskCounts() {
  return {
    total: 0,
    active: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
    rejected: 0,
    submitted: 0,
    queued: 0,
    inputRequired: 0,
    authRequired: 0,
    waitingOnExternal: 0,
    working: 0,
  };
}
