import { describe, expect, it, vi } from 'vitest';
import {
  IdempotencyOwnershipError,
  InMemoryIdempotencyStore,
} from '../src/server/IdempotencyStore.js';
import {
  completeIdempotency,
  releaseIdempotency,
  startIdempotencyLease,
} from '../src/server/http/idempotency.js';
import { RuntimeMetrics } from '../src/telemetry/RuntimeMetrics.js';

describe('atomic idempotency reservations', () => {
  it('grants one owner for concurrent identical reservations', async () => {
    const store = new InMemoryIdempotencyStore();

    const [first, second] = await Promise.all([
      store.reserve('scope', 'key', 'fingerprint', 1_000),
      store.reserve('scope', 'key', 'fingerprint', 1_000),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual(['acquired', 'in-progress']);
  });

  it('rejects a conflicting fingerprint before a second owner is granted', async () => {
    const store = new InMemoryIdempotencyStore();

    await expect(store.reserve('scope', 'key', 'fingerprint-a', 1_000)).resolves.toMatchObject({
      outcome: 'acquired',
    });
    await expect(store.reserve('scope', 'key', 'fingerprint-b', 1_000)).resolves.toMatchObject({
      outcome: 'conflict',
    });
  });

  it('recovers an abandoned lease after deterministic expiry', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      const first = await store.reserve('scope', 'key', 'fingerprint', 1_000);
      expect(first.outcome).toBe('acquired');
      if (first.outcome !== 'acquired') throw new Error('expected acquired lease');

      vi.advanceTimersByTime(1_001);
      const recovered = await store.reserve('scope', 'key', 'fingerprint', 1_000);

      expect(recovered.outcome).toBe('recovered');
      if (recovered.outcome !== 'recovered') throw new Error('expected recovered lease');
      expect(recovered.record.ownerId).not.toBe(first.record.ownerId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an expired lease bound to its original fingerprint during retention', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      await store.reserve('scope', 'key', 'fingerprint-a', 1_000);

      vi.advanceTimersByTime(1_001);
      await expect(store.reserve('scope', 'key', 'fingerprint-b', 1_000)).resolves.toMatchObject({
        outcome: 'conflict',
        record: { state: 'in-flight', fingerprint: 'fingerprint-a' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a fresh fingerprint after abandoned-reservation retention expires', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      await store.reserve('scope', 'key', 'fingerprint-a', 1_000);

      vi.advanceTimersByTime(60_001);
      await expect(store.reserve('scope', 'key', 'fingerprint-b', 1_000)).resolves.toMatchObject({
        outcome: 'acquired',
        record: { state: 'in-flight', fingerprint: 'fingerprint-b' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows only the current owner to complete a reservation and replays the result', async () => {
    const store = new InMemoryIdempotencyStore();
    const reservation = await store.reserve('scope', 'key', 'fingerprint', 1_000);
    if (reservation.outcome !== 'acquired') throw new Error('expected owner');

    await expect(
      store.complete(
        'scope',
        'key',
        'wrong-owner',
        { kind: 'success', value: { ok: false } },
        60_000,
      ),
    ).rejects.toBeInstanceOf(IdempotencyOwnershipError);

    await store.complete(
      'scope',
      'key',
      reservation.record.ownerId,
      { kind: 'success', value: { ok: true } },
      60_000,
    );

    await expect(store.reserve('scope', 'key', 'fingerprint', 1_000)).resolves.toMatchObject({
      outcome: 'replay',
      record: {
        state: 'completed',
        result: { kind: 'success', value: { ok: true } },
      },
    });
  });

  it('ignores a delayed renewal result after the lease controller stops', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      const reservation = await store.reserve('scope', 'key', 'fingerprint', 75);
      if (reservation.outcome !== 'acquired') throw new Error('expected owner');

      let resolveRenewal!: (value: boolean) => void;
      const renewal = new Promise<boolean>((resolve) => {
        resolveRenewal = resolve;
      });
      vi.spyOn(store, 'renew').mockReturnValue(renewal);
      const metrics = new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' });
      const lease = startIdempotencyLease(
        {
          scope: 'scope',
          key: 'key',
          fingerprint: 'fingerprint',
          ownerId: reservation.record.ownerId,
          leaseMs: 75,
        },
        store,
        metrics,
        'message/send',
      );

      await vi.advanceTimersByTimeAsync(25);
      expect(store.renew).toHaveBeenCalledTimes(1);
      lease?.stop();
      resolveRenewal(false);
      await Promise.resolve();
      await Promise.resolve();

      expect(lease?.ownershipLost()).toBe(false);
      expect(metrics.renderPrometheus(emptyTaskCounts())).toContain(
        'a2a_runtime_idempotency_total{service_name="test",service_version="1.0.0",outcome="lease-lost"} 0',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('renews only a live matching owner and releases retryable failures', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      const reservation = await store.reserve('scope', 'key', 'fingerprint', 1_000);
      if (reservation.outcome !== 'acquired') throw new Error('expected owner');

      vi.advanceTimersByTime(700);
      await expect(store.renew('scope', 'key', reservation.record.ownerId, 1_000)).resolves.toBe(
        true,
      );
      vi.advanceTimersByTime(700);
      await expect(store.reserve('scope', 'key', 'fingerprint', 1_000)).resolves.toMatchObject({
        outcome: 'in-progress',
      });

      await expect(store.release('scope', 'key', reservation.record.ownerId)).resolves.toBe(true);
      await expect(store.reserve('scope', 'key', 'fingerprint', 1_000)).resolves.toMatchObject({
        outcome: 'acquired',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks lease ownership lost when renewal is rejected', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      const reservation = await store.reserve('scope', 'key', 'fingerprint', 75);
      if (reservation.outcome !== 'acquired') throw new Error('expected owner');
      vi.spyOn(store, 'renew').mockResolvedValue(false);
      const metrics = new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' });
      const lease = startIdempotencyLease(
        {
          scope: 'scope',
          key: 'key',
          fingerprint: 'fingerprint',
          ownerId: reservation.record.ownerId,
          leaseMs: 75,
        },
        store,
        metrics,
        'message/send',
      );

      await vi.advanceTimersByTimeAsync(25);

      expect(lease?.ownershipLost()).toBe(true);
      expect(metrics.renderPrometheus(emptyTaskCounts())).toContain(
        'a2a_runtime_idempotency_total{service_name="test",service_version="1.0.0",outcome="lease-lost"} 1',
      );
      lease?.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks lease ownership lost when renewal throws', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryIdempotencyStore();
      const reservation = await store.reserve('scope', 'key', 'fingerprint', 75);
      if (reservation.outcome !== 'acquired') throw new Error('expected owner');
      vi.spyOn(store, 'renew').mockRejectedValue(new Error('redis unavailable'));
      const metrics = new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' });
      const lease = startIdempotencyLease(
        {
          scope: 'scope',
          key: 'key',
          fingerprint: 'fingerprint',
          ownerId: reservation.record.ownerId,
          leaseMs: 75,
        },
        store,
        metrics,
        'message/send',
      );

      await vi.advanceTimersByTimeAsync(25);

      expect(lease?.ownershipLost()).toBe(true);
      lease?.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips lease and terminal helpers without an owner and forwards owned transitions', async () => {
    const store = new InMemoryIdempotencyStore();
    const metrics = new RuntimeMetrics({ serviceName: 'test', serviceVersion: '1.0.0' });
    expect(
      startIdempotencyLease(
        { scope: 'scope', key: 'key', fingerprint: 'fingerprint' },
        store,
        metrics,
        'message/send',
      ),
    ).toBeUndefined();

    const complete = vi.spyOn(store, 'complete');
    const release = vi.spyOn(store, 'release');
    const ownerless = { scope: 'scope', key: 'key', fingerprint: 'fingerprint' };
    await completeIdempotency(store, ownerless, { kind: 'success', value: null }, 1_000);
    await releaseIdempotency(store, ownerless);
    await releaseIdempotency(store, undefined);
    expect(complete).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();

    const reservation = await store.reserve('scope', 'key', 'fingerprint', 1_000);
    if (reservation.outcome !== 'acquired') throw new Error('expected owner');
    const owned = { ...ownerless, ownerId: reservation.record.ownerId, leaseMs: 1_000 };
    await completeIdempotency(store, owned, { kind: 'success', value: { ok: true } }, 1_000);
    expect(complete).toHaveBeenCalledTimes(1);

    const second = await store.reserve('scope', 'second', 'fingerprint', 1_000);
    if (second.outcome !== 'acquired') throw new Error('expected second owner');
    await releaseIdempotency(store, {
      scope: 'scope',
      key: 'second',
      fingerprint: 'fingerprint',
      ownerId: second.record.ownerId,
      leaseMs: 1_000,
    });
    expect(release).toHaveBeenCalledTimes(1);
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
