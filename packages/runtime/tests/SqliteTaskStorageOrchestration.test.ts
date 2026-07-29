import { describe, expect, it } from 'vitest';
import { SerializedAsyncOperationQueue } from '../src/storage/SerializedAsyncOperationQueue.js';
import { createSqliteTaskStorageContext } from '../src/storage/SqliteTaskStorageContext.js';

describe('SQLite storage orchestration', () => {
  it('serializes operations, permits scoped nested work, and recovers after rejection', async () => {
    const queue = new SerializedAsyncOperationQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = queue.run(async () => {
      order.push('first:start');
      markFirstStarted?.();
      await firstGate;
      order.push('first:end');
      return 1;
    });
    await firstStarted;

    const second = queue.run(() => {
      order.push('second');
      return 2;
    });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);

    await expect(
      queue.run(() => {
        throw new Error('expected rejection');
      }),
    ).rejects.toThrow('expected rejection');
    await expect(queue.run(() => 'recovered')).resolves.toBe('recovered');

    await expect(
      queue.runInScope(async () => queue.run(() => 'nested without deadlock')),
    ).resolves.toBe('nested without deadlock');
  });

  it('creates one normalized SQLite context for sync and async storage classes', () => {
    const now = () => new Date('2026-07-30T00:00:00.000Z');
    const context = createSqliteTaskStorageContext(':memory:', {
      busyTimeoutMs: 2_345,
      defaultTenantId: ' tenant-a ',
      now,
    });

    expect(context.options).toMatchObject({
      busyTimeoutMs: 2_345,
      defaultTenantId: 'tenant-a',
      now,
    });
    expect(context.taskOptions.defaultTenantId).toBe('tenant-a');
    expect(context.taskOptions.now).toBe(now);
    expect(context.retentionOptions.now).toBe(now);
    expect(context.artifactOptions.now).toBe(now);
    expect(context.db.prepare<{ timeout: number }>('PRAGMA busy_timeout').get()?.timeout).toBe(
      2_345,
    );

    context.db.close?.();
  });
});
