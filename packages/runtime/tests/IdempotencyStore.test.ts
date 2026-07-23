import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildIdempotencyFingerprint,
  InMemoryIdempotencyStore,
  RedisIdempotencyStore,
  type RedisIdempotencyClient,
} from '../src/server/IdempotencyStore.js';

type MutableStringPrototype = typeof String.prototype & {
  toWellFormed?: () => string;
};

async function withoutNativeToWellFormed(callback: () => Promise<void>): Promise<void> {
  const stringPrototype = String.prototype as MutableStringPrototype;
  const originalToWellFormed = Object.getOwnPropertyDescriptor(stringPrototype, 'toWellFormed');

  Object.defineProperty(stringPrototype, 'toWellFormed', {
    configurable: true,
    value: undefined,
  });

  try {
    await callback();
  } finally {
    if (originalToWellFormed) {
      Object.defineProperty(stringPrototype, 'toWellFormed', originalToWellFormed);
    } else {
      delete stringPrototype.toWellFormed;
    }
  }
}

describe('IdempotencyStore', () => {
  it('builds stable fingerprints independent of object key order', () => {
    expect(buildIdempotencyFingerprint({ b: 2, a: { d: 4, c: [3, 2] } })).toBe(
      buildIdempotencyFingerprint({ a: { c: [3, 2], d: 4 }, b: 2 }),
    );
  });

  it('preserves array order in request fingerprints', () => {
    expect(buildIdempotencyFingerprint({ params: ['first', 'second'] })).not.toBe(
      buildIdempotencyFingerprint({ params: ['second', 'first'] }),
    );
  });

  it('domain-separates request fingerprints from raw SHA-256 digests', () => {
    const payload = { method: 'message/send', params: { apiKey: 'sk-test-secret', value: 1 } };
    const rawDigest = createHash('sha256')
      .update('{"method":"message/send","params":{"apiKey":"sk-test-secret","value":1}}')
      .digest('hex');

    const fingerprint = buildIdempotencyFingerprint(payload);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprint).not.toBe(rawDigest);
    expect(fingerprint).not.toContain('sk-test-secret');
    expect(fingerprint).not.toContain('apiKey');
  });

  it('stores process-local records with TTL and clone isolation', async () => {
    vi.useFakeTimers();
    const store = new InMemoryIdempotencyStore();

    const record = await store.set(
      'tenant-a:user-a:route',
      'key-1',
      'fingerprint',
      { kind: 'success', value: { ok: true } },
      1000,
    );
    (record.result as { kind: 'success'; value: { ok: boolean } }).value.ok = false;

    expect(await store.get('tenant-a:user-a:route', 'key-1')).toEqual(
      expect.objectContaining({
        scope: 'tenant-a:user-a:route',
        key: 'key-1',
        fingerprint: 'fingerprint',
        result: { kind: 'success', value: { ok: true } },
      }),
    );

    vi.advanceTimersByTime(1001);
    await expect(store.get('tenant-a:user-a:route', 'key-1')).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('keeps process-local records distinct when scope and key contain delimiters', async () => {
    const store = new InMemoryIdempotencyStore();

    await store.set(
      'tenant-a:user-a',
      'route',
      'fingerprint-a',
      { kind: 'success', value: { request: 'a' } },
      1000,
    );
    await store.set(
      'tenant-a',
      'user-a:route',
      'fingerprint-b',
      { kind: 'success', value: { request: 'b' } },
      1000,
    );

    await expect(store.get('tenant-a:user-a', 'route')).resolves.toEqual(
      expect.objectContaining({
        scope: 'tenant-a:user-a',
        key: 'route',
        fingerprint: 'fingerprint-a',
      }),
    );
    await expect(store.get('tenant-a', 'user-a:route')).resolves.toEqual(
      expect.objectContaining({
        scope: 'tenant-a',
        key: 'user-a:route',
        fingerprint: 'fingerprint-b',
      }),
    );
  });

  it('handles malformed UTF-16 in process-local storage keys', async () => {
    const store = new InMemoryIdempotencyStore();

    await store.set(
      'tenant-\uD800',
      'route-\uD800',
      'fingerprint',
      { kind: 'success', value: { ok: true } },
      1000,
    );

    await expect(store.get('tenant-\uD800', 'route-\uD800')).resolves.toEqual(
      expect.objectContaining({
        scope: 'tenant-\uD800',
        key: 'route-\uD800',
        fingerprint: 'fingerprint',
      }),
    );
  });

  it('stores Redis records with TTL and ignores expired payloads', async () => {
    const values = new Map<string, string>();
    const expirations = new Map<string, number>();
    const client: RedisIdempotencyClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
      pexpire: vi.fn(async (key, ttlMs) => {
        expirations.set(key, ttlMs);
        return 1;
      }),
    };
    const store = new RedisIdempotencyStore(client, 'prefix');

    await expect(store.get('scope', 'missing')).resolves.toBeNull();

    const record = await store.set(
      'scope',
      'key',
      'fingerprint',
      { kind: 'error', error: { code: -32000, message: 'nope' } },
      500,
    );

    expect(record.result).toEqual({ kind: 'error', error: { code: -32000, message: 'nope' } });
    expect(expirations.get('prefix:scope:key')).toBe(500);
    await expect(store.get('scope', 'key')).resolves.toEqual(record);

    values.set(
      'prefix:scope:key',
      JSON.stringify({
        ...record,
        expiresAt: Date.now() - 1,
      }),
    );
    await expect(store.get('scope', 'key')).resolves.toBeNull();
  });

  it('handles malformed UTF-16 in Redis storage keys', async () => {
    const values = new Map<string, string>();
    const client: RedisIdempotencyClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
      pexpire: vi.fn(async () => 1),
    };
    const store = new RedisIdempotencyStore(client, 'prefix');

    await store.set(
      'tenant-\uD800',
      'route-\uD800',
      'fingerprint',
      { kind: 'success', value: { ok: true } },
      1000,
    );

    expect(values.has('prefix:tenant-%EF%BF%BD:route-%EF%BF%BD')).toBe(true);
    await expect(store.get('tenant-\uD800', 'route-\uD800')).resolves.toEqual(
      expect.objectContaining({
        scope: 'tenant-\uD800',
        key: 'route-\uD800',
        fingerprint: 'fingerprint',
      }),
    );
  });

  it('falls back to local UTF-16 normalization when toWellFormed is unavailable', async () => {
    const values = new Map<string, string>();
    const client: RedisIdempotencyClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
      pexpire: vi.fn(async () => 1),
    };
    const store = new RedisIdempotencyStore(client, 'prefix');

    await withoutNativeToWellFormed(async () => {
      await store.set(
        'ok-\uD83D\uDE00-\uD800-\uDC00-z',
        'route-\uD800',
        'fingerprint',
        { kind: 'success', value: { ok: true } },
        1000,
      );
    });

    expect(values.has('prefix:ok-%F0%9F%98%80-%EF%BF%BD-%EF%BF%BD-z:route-%EF%BF%BD')).toBe(true);
  });

  it('keeps Redis records distinct when scope and key contain delimiters', async () => {
    const values = new Map<string, string>();
    const expirations = new Map<string, number>();
    const client: RedisIdempotencyClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
      pexpire: vi.fn(async (key, ttlMs) => {
        expirations.set(key, ttlMs);
        return 1;
      }),
    };
    const store = new RedisIdempotencyStore(client, 'prefix');

    await store.set(
      'tenant-a:user-a',
      'route',
      'fingerprint-a',
      { kind: 'success', value: { request: 'a' } },
      1000,
    );
    await store.set(
      'tenant-a',
      'user-a:route',
      'fingerprint-b',
      { kind: 'success', value: { request: 'b' } },
      1000,
    );

    expect(values).toHaveLength(2);
    expect(values.has('prefix:tenant-a%3Auser-a:route')).toBe(true);
    expect(values.has('prefix:tenant-a:user-a%3Aroute')).toBe(true);
    await expect(store.get('tenant-a:user-a', 'route')).resolves.toEqual(
      expect.objectContaining({
        scope: 'tenant-a:user-a',
        key: 'route',
        fingerprint: 'fingerprint-a',
      }),
    );
    await expect(store.get('tenant-a', 'user-a:route')).resolves.toEqual(
      expect.objectContaining({
        scope: 'tenant-a',
        key: 'user-a:route',
        fingerprint: 'fingerprint-b',
      }),
    );
  });

  it('executes atomic Redis reservation transitions through eval', async () => {
    const now = Date.now();
    const inFlight = {
      state: 'in-flight' as const,
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      ownerId: 'owner-1',
      reservedAt: now,
      expiresAt: now + 1_000,
    };
    const completed = {
      state: 'completed' as const,
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      storedAt: new Date(now).toISOString(),
      expiresAt: now + 60_000,
      result: { kind: 'success' as const, value: { ok: true } },
    };
    const evalMock = vi
      .fn<NonNullable<RedisIdempotencyClient['eval']>>()
      .mockResolvedValueOnce(JSON.stringify({ outcome: 'acquired', record: inFlight }))
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(JSON.stringify({ outcome: 'completed', record: completed }))
      .mockResolvedValueOnce(1);
    const store = new RedisIdempotencyStore(
      { get: vi.fn(async () => null), eval: evalMock },
      'prefix',
    );

    await expect(store.reserve('scope', 'key', 'fingerprint', 1_000)).resolves.toEqual({
      outcome: 'acquired',
      record: inFlight,
    });
    await expect(store.renew('scope', 'key', 'owner-1', 1_000)).resolves.toBe(true);
    await expect(
      store.complete('scope', 'key', 'owner-1', { kind: 'success', value: { ok: true } }, 60_000),
    ).resolves.toEqual(completed);
    await expect(store.release('scope', 'key', 'owner-1')).resolves.toBe(true);

    expect(evalMock).toHaveBeenCalledTimes(4);
    expect(evalMock.mock.calls[0]?.[1]).toMatchObject({
      keys: ['prefix:scope:key'],
      arguments: ['scope', 'key', 'fingerprint', expect.any(String), '1000'],
    });
  });

  it('normalizes Redis conflict, replay, and in-progress outcomes', async () => {
    const now = Date.now();
    const inFlight = {
      state: 'in-flight' as const,
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      ownerId: 'owner-1',
      reservedAt: now,
      expiresAt: now + 1_000,
    };
    const failed = {
      state: 'failed' as const,
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      storedAt: new Date(now).toISOString(),
      expiresAt: now + 60_000,
      result: { kind: 'error' as const, error: { code: -32000, message: 'failed' } },
    };
    const evalMock = vi
      .fn<NonNullable<RedisIdempotencyClient['eval']>>()
      .mockResolvedValueOnce(JSON.stringify({ outcome: 'conflict', record: inFlight }))
      .mockResolvedValueOnce(JSON.stringify({ outcome: 'replay', record: failed }))
      .mockResolvedValueOnce(JSON.stringify({ outcome: 'in-progress', record: inFlight }));
    const store = new RedisIdempotencyStore({ get: vi.fn(async () => null), eval: evalMock });

    await expect(store.reserve('scope', 'key', 'other', 1_000)).resolves.toMatchObject({
      outcome: 'conflict',
      record: inFlight,
    });
    await expect(store.reserve('scope', 'key', 'fingerprint', 1_000)).resolves.toEqual({
      outcome: 'replay',
      record: failed,
    });
    await expect(store.reserve('scope', 'key', 'fingerprint', 1_000)).resolves.toEqual({
      outcome: 'in-progress',
      record: inFlight,
    });
  });

  it('fails closed for malformed Redis script responses and records', async () => {
    const now = Date.now();
    const inFlight = {
      state: 'in-flight' as const,
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      ownerId: 'owner-1',
      reservedAt: now,
      expiresAt: now + 1_000,
    };
    const completed = {
      state: 'completed' as const,
      scope: 'scope',
      key: 'key',
      fingerprint: 'fingerprint',
      storedAt: new Date(now).toISOString(),
      expiresAt: now + 60_000,
      result: { kind: 'success' as const, value: { ok: true } },
    };

    await expect(
      new RedisIdempotencyStore({ get: vi.fn(async () => null) }).reserve(
        'scope',
        'key',
        'fingerprint',
        1_000,
      ),
    ).rejects.toThrow('require a node-redis compatible eval() client');

    const invalidJsonStore = new RedisIdempotencyStore({
      get: vi.fn(async () => null),
      eval: vi.fn(async () => 1),
    });
    await expect(
      invalidJsonStore.reserve('scope', 'key', 'fingerprint', 1_000),
    ).rejects.toBeInstanceOf(TypeError);

    const invalidReplayStore = new RedisIdempotencyStore({
      get: vi.fn(async () => null),
      eval: vi.fn(async () => JSON.stringify({ outcome: 'replay', record: inFlight })),
    });
    await expect(invalidReplayStore.reserve('scope', 'key', 'fingerprint', 1_000)).rejects.toThrow(
      'Invalid Redis replay reservation record',
    );

    const invalidOwnerStore = new RedisIdempotencyStore({
      get: vi.fn(async () => null),
      eval: vi.fn(async () => JSON.stringify({ outcome: 'acquired', record: completed })),
    });
    await expect(invalidOwnerStore.reserve('scope', 'key', 'fingerprint', 1_000)).rejects.toThrow(
      'Invalid Redis acquired reservation record',
    );

    const lostStore = new RedisIdempotencyStore({
      get: vi.fn(async () => null),
      eval: vi.fn(async () => JSON.stringify({ outcome: 'lost' })),
    });
    await expect(
      lostStore.complete('scope', 'key', 'owner-1', { kind: 'success', value: null }, 1_000),
    ).rejects.toThrow('Idempotency reservation ownership was lost');

    const invalidCompletedStore = new RedisIdempotencyStore({
      get: vi.fn(async () => null),
      eval: vi.fn(async () => JSON.stringify({ outcome: 'completed', record: inFlight })),
    });
    await expect(
      invalidCompletedStore.complete(
        'scope',
        'key',
        'owner-1',
        { kind: 'success', value: null },
        1_000,
      ),
    ).rejects.toThrow('Idempotency reservation ownership was lost');

    const malformedInFlight = new RedisIdempotencyStore({
      get: vi.fn(async () =>
        JSON.stringify({
          state: 'in-flight',
          scope: 'scope',
          key: 'key',
          fingerprint: 'fingerprint',
          expiresAt: now + 1_000,
        }),
      ),
    });
    await expect(malformedInFlight.get('scope', 'key')).rejects.toBeInstanceOf(TypeError);

    const malformedTerminal = new RedisIdempotencyStore({
      get: vi.fn(async () =>
        JSON.stringify({
          state: 'completed',
          scope: 'scope',
          key: 'key',
          fingerprint: 'fingerprint',
          expiresAt: now + 1_000,
        }),
      ),
    });
    await expect(malformedTerminal.get('scope', 'key')).rejects.toThrow(
      'Invalid terminal idempotency record',
    );

    const invalidResult = new RedisIdempotencyStore({
      get: vi.fn(async () =>
        JSON.stringify({
          state: 'completed',
          scope: 'scope',
          key: 'key',
          fingerprint: 'fingerprint',
          expiresAt: now + 1_000,
          result: { kind: 'unknown' },
        }),
      ),
    });
    await expect(invalidResult.get('scope', 'key')).rejects.toThrow('Invalid idempotency result');

    const activeReservation = new RedisIdempotencyStore({
      get: vi.fn(async () => JSON.stringify(inFlight)),
      set: vi.fn(async () => undefined),
      pexpire: vi.fn(async () => 1),
    });
    await expect(
      activeReservation.set('scope', 'key', 'fingerprint', { kind: 'success', value: null }, 1_000),
    ).rejects.toThrow('Cannot overwrite an active idempotency reservation');

    const missingLegacyMethods = new RedisIdempotencyStore({ get: vi.fn(async () => null) });
    await expect(
      missingLegacyMethods.set(
        'scope',
        'key',
        'fingerprint',
        { kind: 'success', value: null },
        1_000,
      ),
    ).rejects.toThrow('Redis idempotency legacy set requires set() and pexpire() support');
  });

  it('enforces in-memory ownership and positive TTL guards', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      await expect(store.get('scope', 'missing')).resolves.toBeNull();
      await expect(store.reserve('scope', 'key', 'fingerprint', 0)).rejects.toBeInstanceOf(
        RangeError,
      );
      await expect(store.renew('scope', 'key', 'owner', 0)).rejects.toBeInstanceOf(RangeError);
      await expect(store.release('scope', 'key', 'owner')).resolves.toBe(false);

      const reservation = await store.reserve('scope', 'key', 'fingerprint', 1_000);
      if (reservation.outcome !== 'acquired') throw new Error('expected acquired reservation');
      await expect(store.renew('scope', 'key', 'wrong-owner', 1_000)).resolves.toBe(false);
      await expect(store.release('scope', 'key', 'wrong-owner')).resolves.toBe(false);
      await expect(
        store.set('scope', 'key', 'fingerprint', { kind: 'success', value: null }, 1_000),
      ).rejects.toThrow('Cannot overwrite a retained idempotency reservation');

      vi.advanceTimersByTime(1_001);
      await expect(
        store.complete(
          'scope',
          'key',
          reservation.record.ownerId,
          { kind: 'success', value: null },
          1_000,
        ),
      ).rejects.toThrow('Idempotency reservation ownership was lost');
    } finally {
      vi.useRealTimers();
    }
  });
});
