# @a2amesh/registry

`@a2amesh/registry` implements the control plane for agent registration, capability discovery, health checks, and signature verification of agent cards.

## Purpose

- **Agent Discovery**: Query registered agents by capabilities, tenant IDs, and namespaces.
- **Trust & Health**: Tracks active agent statuses, performs periodic health polling, and verifies cryptographic signatures on cards.
- **Unified Registry API**: Serves JSON-RPC endpoints for registration and matching.

## Installation

```bash
npm install @a2amesh/registry
```

## Usage Example

```typescript
import { RegistryServer } from '@a2amesh/registry';

const registry = new RegistryServer({
  port: 4000,
  storage: 'memory',
});

await registry.start();
```

## API Reference

See the [OpenAPI specification](/openapi/registry.openapi.json) for the complete registry API reference.

## Release State

- **Channel**: Public Alpha
- **Initial Version**: `0.1.0-alpha.0`

## Production Redis and Distributed Polling

Production registry deployments should use Redis-backed storage when more than one registry instance is active.

Redis storage provides:

- set-based indexes for status, tenant, skill, tag, name, transport, MCP compatibility, and public discovery queries;
- batched mutations with Redis transactions when the client exposes `multi()`;
- fallback JSON-array indexes for simple Redis-like clients used in tests and local prototypes;
- polling lease records under the registry prefix for distributed health and task polling coordination.

### Distributed polling leases

Set `distributedPollingLeases: true` when multiple registry processes share the same Redis storage. The polling controller then attempts a Redis-backed lease before scheduled health checks or task snapshot polling.

Recommended options:

```typescript
new RegistryServer({
  storage: redisStorage,
  distributedPollingLeases: true,
  pollingLeaseOwnerId: process.env.HOSTNAME,
  pollingLeaseTtlMs: 60_000,
});
```

Lease behavior:

- only the instance that acquires the lease runs the scheduled polling tick;
- other instances skip that tick and try again on the next interval;
- stale lease records are overwritten when their `expiresAt` value is in the past;
- the owner releases the lease after the polling operation completes;
- TTL should be at least twice the polling interval for normal deployments.

### Failure handling assumptions

- Health check failures increment `consecutiveFailures` and mark the agent unhealthy.
- Successful checks reset `consecutiveFailures` and update `lastSuccessAt`.
- Task polling skips malformed payloads and non-array responses rather than poisoning the registry projection.
- Redis clients used in production should support `SET ... NX PX`, set commands, and transactions. Without those capabilities, deployments should run a single registry poller or keep `distributedPollingLeases` disabled.
