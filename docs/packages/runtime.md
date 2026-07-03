# @a2amesh/runtime

`@a2amesh/runtime` provides the core server and client implementation, task lifecycle management, push notification routing, and telemetry hooks for Agent2Agent-native systems.

## Purpose

- **A2A Client & Server**: Direct HTTP/SSE/WebSocket communication, serialization, and handshake handling.
- **Task Lifecycle**: Methods to start, cancel, update, and retrieve task states.
- **Pluggable Architecture**: Integrates with custom storage backend providers, telemetry exporters, and authorization checks.

## Installation

```bash
npm install @a2amesh/runtime
```

## Usage Example

```typescript
import { A2AServer, A2AClient } from '@a2amesh/runtime';

const server = new A2AServer({
  port: 8080,
  handlers: {
    'message/send': async (message) => {
      // Process incoming A2A message
      return { status: 'completed' };
    },
  },
});

await server.start();
```

## SQLite Task Storage

`SqliteTaskStorage` and `AsyncSqliteTaskStorage` (`packages/runtime/src/storage/SqliteTaskStorage.ts`) are production-grade task storage backends built on Node's built-in `node:sqlite` module.

### Versioned migrations

- Schema state is tracked in a `storage_schema_migrations` table (`version`, `applied_at`).
- Migrations run in order inside `BEGIN IMMEDIATE` / `COMMIT` transactions; a failed migration rolls back and throws `SQLite task storage migration <n> failed`, leaving the schema at the last successfully applied version.
- Opening a database at the current schema version is a no-op (idempotent fresh/repeat initialization).
- Opening a database with a schema version newer than `SQLITE_TASK_STORAGE_SCHEMA_VERSION` throws (`newer than supported version <n>`) instead of silently downgrading data.
- Legacy pre-migration databases (a bare `tasks`/`push_notifications` schema) are upgraded in place without data loss.

### Production SQLite settings

On every open, `initializeSqliteTaskStorage` sets:

- `PRAGMA journal_mode = WAL` (where supported by the runtime),
- `PRAGMA synchronous = NORMAL`,
- `PRAGMA foreign_keys = ON`,
- `PRAGMA busy_timeout` from `SqliteTaskStorageOptions.busyTimeoutMs` (default `5000`ms, 0–120000ms).

Indexes cover the core lookup paths: `context_id`, `status`, `tenant_id`, `updated_at`, `expires_at`, and the composite `(tenant_id, status, updated_at)` index used by retention cleanup. `getOperationalState()` reports the active schema version, journal mode, busy timeout, and index list; `explainRetentionQueryPlan()` returns the `EXPLAIN QUERY PLAN` output for the retention query so index usage can be verified in tests and operations.

### TTL and retention cleanup

- `setTtl(taskId, ttlMs, tenantId?)` sets an explicit expiry on a task.
- `cleanupRetention(policy: TaskRetentionPolicy)` deletes tasks (and their artifacts) in a single tenant that are past their TTL for their terminal/paused state (`completedTtlMs`, `failedTtlMs`, `canceledTtlMs`, `rejectedTtlMs`, `stalePausedTtlMs`) or past an explicit `setTtl` expiry.
- Active tasks (`SUBMITTED`, `QUEUED`, `WORKING`) are never eligible for cleanup.
- Cleanup only ever touches the requested `tenantId`; other tenants are untouched.
- The result (`TaskCleanupResult`) reports `deletedTasks`, `deletedArtifacts`, and `evaluatedAt` so callers can log/alert on cleanup volume.

### Audit journal

- Every task create/update/delete and every `cleanupRetention`/`saveArtifact` call appends an entry to `task_audit_journal` via `appendAuditEntry` / `listAuditEntries`.
- Entries carry `sequence` (monotonic, auto-increment), `taskId`, `tenantId`, `principalId?`, `action`, `outcome` (`success | failure | denied`), `timestamp`, and `correlationId?`.
- `principalId`/`correlationId` values are pulled from task metadata and redacted (`[REDACTED]`) when they look like they contain a bearer token, password, secret, or token — the journal is safe to export without leaking credentials.
- `listAuditEntries(tenantId, taskId?, limit?)` returns entries in insertion order, scoped to a single tenant.

### Artifact persistence contract

`TaskStorageContracts.ts` defines `PersistedTaskArtifact` and `validatePersistedTaskArtifact`, enforced by `saveArtifact`:

- `taskId`/`artifactId`/`tenantId` are required and the artifact's tenant must match the owning task's tenant.
- `checksumSha256` must be a 64-character hex SHA-256 digest.
- `contentType` must be a valid media type.
- `payloadRef` must be an absolute `https:`, `s3:`, `gs:`, or `file:` reference with no embedded credentials, query string, or fragment.
- Artifacts marked `sensitivity: 'secret'` must be `redacted: true` before they can be persisted.
- `provenance` (`producerId`, `taskId`, optional `workspace`/`branch`/`commit`/`commandHash`) is stored alongside the artifact for traceability.

## Release State

- **Channel**: Public Alpha
- **Initial Version**: `0.1.0-alpha.0`
