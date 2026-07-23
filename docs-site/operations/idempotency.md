# Idempotency Reservations

A2A Mesh reserves an `Idempotency-Key` before dispatching a protected JSON-RPC operation. One owner
may execute the operation; concurrent identical requests receive an in-progress response and later
retries replay the terminal result.

## Outcomes

| Condition                                  | Result                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| First matching request                     | Acquires a renewable `in-flight` lease.                   |
| Concurrent identical request               | `IdempotencyInProgress` (`-32044`).                       |
| Same key with a different request          | `IdempotencyConflict` (`-32043`).                         |
| Matching request after successful response | Replays the stored result with `replayed: true`.          |
| Matching request after lease expiry        | Atomically recovers the abandoned lease as the new owner. |

`idempotencyLeaseMs` defaults to 30 seconds. `idempotencyTtlMs` defaults to one hour and controls
how long completed or protocol-error responses remain replayable.

An abandoned key remains bound to its original fingerprint during a bounded retention window. A
different payload therefore still conflicts after lease expiry, while the original payload can
recover ownership. Both stores retain abandoned reservations for at least 60 seconds from reservation
time; longer leases use twice the lease duration. After retention expires, a later request may acquire
the key as fresh.

## Single process and multiple replicas

`InMemoryIdempotencyStore` coordinates only one Node.js process. Use it for local development and
single-process deployments.

Every horizontally scaled runtime replica must share a `RedisIdempotencyStore`. Its Lua transitions
atomically compare the fingerprint and owner token before reserving, renewing, completing, or
releasing a record. Redis server time controls lease expiry, so replica host clocks do not decide
ownership.

```ts
import { createClient } from 'redis';
import { RedisIdempotencyStore } from '@a2amesh/runtime';

const redis = createClient({ url: process.env['REDIS_URL'] });
await redis.connect();

const options = {
  idempotencyStore: new RedisIdempotencyStore(redis),
  idempotencyLeaseMs: 30_000,
  idempotencyTtlMs: 60 * 60 * 1_000,
};
```

## Metrics

`a2a_runtime_idempotency_total` uses only a bounded `outcome` label: `acquired`, `recovered`,
`replay`, `in-progress`, `conflict`, or `lease-lost`. Raw keys, fingerprints, scopes, and request
bodies are excluded from metrics and logs.

See the canonical
[operations guide](https://github.com/oaslananka/a2amesh/blob/main/docs/operations/idempotency.md)
for failure recovery, deployment checks, and storage contract details.
