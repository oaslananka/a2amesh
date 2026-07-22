# Idempotency Reservations

A2A Mesh reserves an idempotency key before executing a protected JSON-RPC operation. The
reservation prevents concurrent retries from running the same side effect more than once within
the configured storage scope.

## Protected methods

The runtime applies reservation semantics to:

- `message/send`
- `message/stream`
- `tasks/cancel`
- `tasks/pushNotification/set`

The reservation identity combines the method, tenant, principal, authentication method,
`Idempotency-Key`, and a deterministic fingerprint of the request parameters. Reusing a key with a
different fingerprint fails before method dispatch.

## State model

| State       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `in-flight` | One owner token holds a renewable lease and may execute the operation.  |
| `completed` | A successful response is stored and can be replayed.                    |
| `failed`    | A protocol error response is stored and can be replayed.                |
| expired     | The lease or terminal replay window elapsed and the record may recover. |

Concurrent requests with the same key and fingerprint receive
`IdempotencyInProgress` (`-32044`) while the owner lease is valid. A completed request returns the
stored response with `metadata.idempotency.replayed: true`. A different fingerprint receives
`IdempotencyConflict` (`-32043`).

## Lease and recovery behavior

`idempotencyLeaseMs` controls the owner lease and defaults to 30 seconds. The runtime renews the
lease while a non-streaming or streaming operation is active. `idempotencyTtlMs` controls the
terminal replay window and defaults to one hour.

If an owner process stops before completion, the record remains `in-flight` through the lease and a
bounded retention window. The idempotency key stays bound to the original fingerprint during that
window: a different payload still conflicts after lease expiry, while the next matching request
atomically replaces the abandoned lease and becomes the new owner. In-memory and Redis stores retain
abandoned reservations for at least 60 seconds from reservation time; longer leases retain them for
twice the lease duration. After retention expires, a later request may acquire the key as fresh. A
stale owner cannot renew or complete a replacement reservation because every transition checks the
owner token.

Unexpected internal failures release the reservation so a retry can acquire it. Protocol errors are
stored as terminal `failed` records so retrying the same request preserves response fidelity.

## Storage choices

`InMemoryIdempotencyStore` is safe only inside one Node.js process. It serializes reservations in the
process-local map, but it cannot coordinate multiple replicas or workers.

Horizontally scaled deployments must provide a shared `RedisIdempotencyStore` to every runtime
replica. The Redis implementation uses Lua scripts for reserve, renew, complete, and release
transitions. Each script performs the read, fingerprint comparison, owner check, write, and TTL
change atomically. Redis server time is used for lease decisions, avoiding application-host clock
skew between replicas.

The Redis client must provide node-redis-compatible `get()` and `eval()` methods. The deprecated
`set()` compatibility method is not a substitute for reservation ownership and refuses to overwrite
an active lease.

```ts
import { createClient } from 'redis';
import { A2AServer, RedisIdempotencyStore } from '@a2amesh/runtime';

const redis = createClient({ url: process.env['REDIS_URL'] });
await redis.connect();

const idempotencyStore = new RedisIdempotencyStore(redis);

class AgentServer extends A2AServer {
  // Implement handleTask(...)
}

const server = new AgentServer(agentCard, {
  idempotencyStore,
  idempotencyLeaseMs: 30_000,
  idempotencyTtlMs: 60 * 60 * 1_000,
});
```

The application owns the Redis client lifecycle and should close it during graceful shutdown.

## Observability

The runtime exports `a2a_runtime_idempotency_total` with one bounded `outcome` label:

- `acquired`
- `recovered`
- `replay`
- `in-progress`
- `conflict`
- `lease-lost`

Logs include only the method and bounded outcome. Raw idempotency keys, fingerprints, scopes, and
request bodies are not metric labels or log fields.

## Operational checks

Before enabling multiple replicas:

1. Configure the same Redis deployment and key prefix for every runtime replica.
2. Set the lease longer than expected transient event-loop stalls and downstream pauses.
3. Keep the replay TTL long enough to cover client retry windows.
4. Alert on sustained `lease-lost`, `recovered`, or `conflict` growth.
5. Verify Redis persistence and failover behavior against the deployment's recovery objectives.
6. Run concurrent same-key and conflicting-fingerprint tests through the deployed load balancer.

Idempotency prevents duplicate runtime dispatch for one scoped key. It does not create exactly-once
semantics in external systems. Downstream APIs should still receive their own idempotency key when
they support one.
