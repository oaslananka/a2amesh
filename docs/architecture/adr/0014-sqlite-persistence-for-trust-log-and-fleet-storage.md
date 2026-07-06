# ADR-0014: SQLite Persistence for Trust Log and Fleet Storage

## Status

Accepted.

## Context

ADR-0012 (Fleet Control Plane Server) and ADR-0013 (Agent Card Trust Log) both
shipped with an in-memory-only storage backend and explicitly flagged the gap:
ADR-0012 noted "`InMemoryFleetStorage` means run/approval/audit state does not
survive a server restart — acceptable for a first operator-facing surface, a
known limitation to close before this graduates past internal/private status,"
and ADR-0013 accepted the same limitation for `InMemoryTrustLogStorage` "the
same known limitation `InMemoryFleetStorage` accepted in ADR-0012 for a first
surface." Both interfaces (`ITrustLogStorage`, `IFleetStorage`) were already
designed to be storage-swappable specifically so a durable backend could be
added later without touching `RegistryServer`, `FleetControlPlaneServer`, or
their routes. `@a2amesh/runtime` already has a production-grade precedent for
exactly this: `SqliteTaskStorage`/`AsyncSqliteTaskStorage`
(`packages/runtime/src/storage/SqliteTaskStorage.ts`), built on Node's
built-in `node:sqlite` module (no external dependency), with an in-code
migration-array pattern (`SqliteTaskStorageMigrations.ts`) tracked via a
`storage_schema_migrations` table.

## Decision

### Reuse `SqliteDatabase`/`SqliteDatabaseConstructor` from `@a2amesh/runtime`

Both `packages/registry` and `packages/fleet-server` already depend on
`@a2amesh/runtime`. Rather than redeclaring the same structural
`SqliteDatabase`/`SqliteStatement`/`SqliteDatabaseConstructor` interfaces a
third time, both new backends import the types `@a2amesh/runtime` already
exports publicly (`export * from './storage/SqliteTaskStorage.js'` re-exports
them). This is downward reuse along the established dependency direction
(`core -> runtime -> registry`, `runtime -> fleet-server`), not a new
cross-package coupling — it avoids duplicating a pure type contract that
carries no driver-specific behavior. The `node:sqlite` driver itself is still
never imported by more than one place per package (`loadSqliteDatabase()`,
mirroring runtime's own helper), and remains injectable via a constructor
option for tests and alternate drivers, matching the pattern
`SqliteTaskStorage` and `RedisStorage` (registry) already established:
accept a client/constructor, never hard-import a concrete driver as the only
option.

### `SqliteTrustLogStorage`: same hash chain, extracted to a shared module

`InMemoryTrustLogStorage`'s `canonicalJsonStringify`/genesis-hash/entry-hash
logic is moved into a new `trustLogHashChain.ts` (still inside
`packages/registry`, not crossing a package boundary) so both backends
produce byte-identical `entryHash` values for the same append sequence —
proven by a cross-backend parity test that appends the same inputs to both
implementations and asserts equal hashes. This matters specifically because a
registry operator migrating from `InMemoryTrustLogStorage` to
`SqliteTrustLogStorage` (or vice versa, e.g. for a disaster-recovery replay)
must get the same tamper-evidence values either way. Sequence numbers stay
zero-based and gap-free by computing `MAX(sequence) + 1` and the previous
entry's `entry_hash` inside `append()`, rather than relying on SQLite's
`AUTOINCREMENT` (which starts at 1) — this keeps both backends' sequence
numbering interchangeable, which the existing `trust-log-storage.test.ts`
suite already asserts.

### `SqliteFleetStorage`: JSON-blob rows plus indexed filter columns

`FleetRunRecord` has a deeply nested shape (`routingDecision`, `artifacts:
FleetArtifactRecord[]`, each with its own nested `provenance`) that does not
benefit from full relational normalization for the query patterns
`IFleetStorage` actually needs (`listRuns` filters only by `status`/
`approvalState`; nothing queries into `routingDecision` or an individual
artifact). Each run is stored as a single `run_json` column — the same
denormalized-JSON-plus-indexed-columns convention `SqliteTaskStorage` uses for
`task_json` — with `status`, `approval_state`, and `created_at` extracted into
real columns so `listRuns` can filter/sort with plain SQL instead of a JSON
scan. `fleet_audit` is a dedicated append-only, sequence-numbered table
(same zero-based, gap-free sequencing approach as the trust log) mirroring
both the runtime's `task_audit_journal` and the trust log's own hash-chain
table shape, though the Fleet audit timeline itself is not hash-chained (per
ADR-0012, Fleet audit is operator-facing evidence, not a tamper-evidence
mechanism — that distinction is unchanged by this ADR).

### Migration versioning: one schema-version table per database file

Each backend creates its own `storage_schema_migrations` table, following
`SqliteTaskStorageMigrations.ts`'s exact convention (`version INTEGER PRIMARY
KEY`, `applied_at TEXT`), on the assumption — already implicit in
`SqliteTaskStorage`'s design — that each storage backend gets its own
dedicated database file. Pointing two different backends (e.g.
`SqliteTrustLogStorage` and `SqliteFleetStorage`) at the same file is
unsupported and undocumented; nothing prevents it structurally, but the
migration-version check (`currentVersion > SCHEMA_VERSION` throws) would
misattribute versions across backends sharing a file.

## Consequences

A registry or Fleet control-plane deployment that needs the trust log or run/
audit state to outlive a process restart can now pass
`new SqliteTrustLogStorage('./trust-log.db')` or
`new SqliteFleetStorage('./fleet.db')` instead of the in-memory defaults, with
zero changes to `RegistryServer`, `FleetControlPlaneServer`, or their routes —
exactly the storage-swap seam ADR-0012/ADR-0013 designed for. `InMemoryTrustLogStorage`
and `InMemoryFleetStorage` remain the defaults for tests and ephemeral
deployments; nothing about default behavior changes. The known gap this ADR
does not close: no migration path exists yet to import existing in-memory
state into a freshly created SQLite file (an operator switching backends
starts with an empty log/run history) — deferred as a separate concern from
persistence itself.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
pnpm --filter @a2amesh/registry run test
pnpm --filter @a2amesh/internal-fleet-server run test
```

Relevant coverage:

- [`SqliteTrustLogStorage tests`](../../../packages/registry/tests/SqliteTrustLogStorage.test.ts)
  (including a cross-backend hash-parity test against `InMemoryTrustLogStorage`)
- [`SqliteFleetStorage tests`](../../../packages/fleet-server/tests/SqliteFleetStorage.test.ts)
