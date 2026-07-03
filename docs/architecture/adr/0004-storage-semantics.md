# ADR-0004: Storage Semantics

## Status

Accepted for the 1.0.0 launch baseline.

## Context

A2A Mesh has two storage domains with different consistency needs.

Runtime task storage persists protocol task bodies, context IDs, owner metadata, task
history, artifacts, push notification configuration, and optional TTL metadata. The
synchronous `ITaskStorage` contract backs `TaskManager`, while the asynchronous
`AsyncTaskStorage` contract backs `AsyncTaskManager` and future networked storage
backends. The runtime lifecycle rules live outside storage in
`packages/runtime/src/server/taskLifecycle.ts`, so storage implementations must not invent
their own task state machine.

Registry storage persists registered agent records, tenant visibility, health status,
skills, tags, transport metadata, and query indexes. Registry storage is intentionally
separate from runtime task storage because discovery data and task execution history have
different ownership, retention, and query patterns.

## Decision

Keep runtime task storage and registry storage as separate contracts.

Runtime task storage backends must preserve complete task payloads and push notification
configuration without changing task lifecycle semantics. `InMemoryTaskStorage` remains
the default local backend. `SqliteTaskStorage` remains an optional durable backend that is
constructed only by consumers that install the optional SQLite dependency. Async runtime
storage is represented by `AsyncTaskStorage`; `SyncTaskStorageAdapter` serializes
synchronous storage mutations and exposes the optional transaction hook used by
`AsyncTaskManager`.

Registry storage remains `IAgentStorage` with async `upsert`, `get`, `list`,
`summarize`, `delete`, `updateStatus`, and `findBySkill` operations. `InMemoryStorage`
is the local/test default, and `RedisStorage` owns Redis-specific indexing for tenant,
public visibility, status, skill, tag, transport, and MCP compatibility queries.

Storage backends may add persistence or indexing optimizations, but they must keep public
contract behavior stable and let runtime or registry managers enforce policy.

`SqliteTaskStorage`/`AsyncSqliteTaskStorage` additionally provide production-hardening
surfaces that are specific to that backend rather than part of the generic `ITaskStorage`/
`AsyncTaskStorage` contracts: versioned schema migrations (`storage_schema_migrations`),
WAL journaling with a configurable busy timeout, production indexes for tenant/status/time
lookups, TTL-based retention cleanup (`cleanupRetention`), an append-only, redacted audit
journal (`appendAuditEntry`/`listAuditEntries`), and a validated artifact persistence
contract (`saveArtifact`/`listArtifacts`, see `TaskStorageContracts.ts`). These are additive
capabilities a caller opts into; they do not change task lifecycle semantics enforced by
`taskLifecycle.ts`. See [`docs/packages/runtime.md`](../../packages/runtime.md) for details.

## Consequences

Runtime storage changes can be tested through the task manager and storage contract
tests without affecting registry discovery. Registry storage can evolve its indexes
without changing runtime task state semantics.

Backends that provide transactions can prevent read/modify/write interleaving in
`AsyncTaskManager`. Backends without transactions still work through the manager-level
mutation queue, but they should not claim cross-process atomicity.

New storage backends must prove parity with the existing storage tests before becoming a
documented supported surface.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
pnpm run test:coverage
pnpm run verify:structure
```

Relevant coverage:

- [`ITaskStorage`](../../../packages/runtime/src/storage/ITaskStorage.ts)
- [`AsyncTaskStorage`](../../../packages/runtime/src/storage/AsyncTaskStorage.ts)
- [`IAgentStorage`](../../../packages/registry/src/storage/IAgentStorage.ts)
- [`InMemoryTaskStorage.test.ts`](../../../packages/runtime/tests/InMemoryTaskStorage.test.ts)
- [`AsyncTaskStorage.test.ts`](../../../packages/runtime/tests/AsyncTaskStorage.test.ts)
- [`SqliteTaskStorage.test.ts`](../../../packages/runtime/tests/SqliteTaskStorage.test.ts)
- [`registry storage tests`](../../../packages/registry/tests/storage.test.ts)
- [`redis storage tests`](../../../packages/registry/tests/redis-storage.test.ts)
