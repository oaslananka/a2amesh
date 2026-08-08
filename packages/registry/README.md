# @a2amesh/registry

Registry server, discovery API, health polling, matching, and storage helpers.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Installation

The supported prerelease channel is `alpha`.

```bash
npm install @a2amesh/registry@alpha
```

Start the installed registry with the default in-memory backend, or inspect its supported environment
variables without starting a server:

```bash
a2amesh-registry
a2amesh-registry --help
```

Repository contributors should run `corepack pnpm run build:clean` before executing the workspace
launcher directly from a source checkout.

## OpenAPI

The registry REST contract is available as [registry.openapi.json](../../docs/openapi/registry.openapi.json) for client generation, UI mocks, and API contract checks.

## Export And Import

The registry control plane supports `GET /admin/agents/export` and `POST /admin/agents/import` for moving registered agent records between registries. Exported documents use `https://oaslananka.github.io/a2amesh/schemas/registry-export.schema.json`; imports are idempotent when records match existing agents by `id` or `url`.

## Redis Storage

The packaged registry process supports shared Redis state without application glue:

```bash
REGISTRY_STORAGE_BACKEND=redis \
REGISTRY_REDIS_URL='rediss://redis.example.com:6379/0' \
REGISTRY_REDIS_PREFIX='a2a:registry:production' \
a2amesh-registry
```

Keep `REGISTRY_REDIS_URL` in the deployment secret manager. Redis mode opens separate clients for the agent directory and the append-only trust log, enables distributed polling leases by default, and closes both clients during graceful shutdown. The trust log uses optimistic Redis transactions and the same SHA-256 hash-chain computation as the in-memory and SQLite implementations.

`RedisStorage` accepts the original JSON key/value client shape:

```ts
new RedisStorage({
  get: (key) => redis.get(key),
  set: (key, value) => redis.set(key, value),
  del: (key) => redis.del(key),
});
```

For production Redis clients, also expose set commands so registry indexes are maintained atomically:

```ts
new RedisStorage({
  get: (key) => redis.get(key),
  set: (key, value) => redis.set(key, value),
  del: (key) => redis.del(key),
  sadd: (key, ...members) => redis.sadd(key, ...members),
  srem: (key, ...members) => redis.srem(key, ...members),
  smembers: (key) => redis.smembers(key),
  multi: () => redis.multi(),
});
```

The lowercase `sadd`, `srem`, and `smembers` methods are the canonical capability interface. Common node-redis aliases `sAdd`, `sRem`, `sMembers`, and raw uppercase command names are also detected. Existing JSON-array clients remain supported for tests and lightweight fakes, so this is a backward-compatible interface expansion.

`RedisTrustLogStorage` requires a dedicated Redis client because Redis `WATCH` state is connection-scoped:

```ts
import { createClient } from 'redis';
import { RegistryServer, RedisStorage, RedisTrustLogStorage } from '@a2amesh/registry';

const directoryClient = createClient({ url });
const trustLogClient = createClient({ url });
await Promise.all([directoryClient.connect(), trustLogClient.connect()]);

const registry = new RegistryServer({
  storage: new RedisStorage(directoryClient, 'a2a:registry'),
  trustLogStorage: new RedisTrustLogStorage(trustLogClient, 'a2a:registry'),
  distributedPollingLeases: true,
});
```
