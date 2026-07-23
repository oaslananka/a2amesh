import { createClient } from 'redis';
import { RedisIdempotencyStore } from '../../../packages/runtime/dist/server/IdempotencyStore.js';

process.on('message', (command) => {
  void run(command);
});

process.send?.({ type: 'ready' });

async function run(command) {
  const client = createClient({ url: command.redisUrl });
  try {
    await client.connect();
    const store = new RedisIdempotencyStore(client, 'a2a:test:idempotency');
    const reservation = await store.reserve(
      command.scope,
      command.key,
      command.fingerprint,
      command.leaseMs,
    );
    let state = reservation.record.state;
    if (
      command.complete &&
      (reservation.outcome === 'acquired' || reservation.outcome === 'recovered') &&
      reservation.record.state === 'in-flight'
    ) {
      const completed = await store.complete(
        command.scope,
        command.key,
        reservation.record.ownerId,
        { kind: 'success', value: { worker: process.pid } },
        60_000,
      );
      state = completed.state;
    }
    process.send?.({
      type: 'result',
      outcome: reservation.outcome,
      state,
    });
  } catch (error) {
    process.send?.({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await client.quit().catch(() => undefined);
    process.disconnect?.();
  }
}
