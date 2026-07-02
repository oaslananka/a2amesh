# Task storage production hardening

This document defines the production contract for task persistence backends.

## Required guarantees

- Apply schema changes through versioned migrations, not ad-hoc table rewrites.
- Enable deterministic indexes for task id, context id, and context-id ordered scans.
- Keep push-notification records bounded by task lifecycle ownership.
- Record storage schema version at startup so operators can verify runtime compatibility.
- Preserve forward compatibility for existing SQLite files created by earlier runtime builds.

## SQLite baseline

The SQLite task backend now creates a `storage_schema_migrations` table and records the active storage schema version during initialization. It also adds a composite `(context_id, id)` index for stable context scans.

## Next production extensions

- TTL/retention policy with explicit purge API.
- Audit journal for insert, update, delete, purge, and push-notification mutations.
- Large artifact policy that keeps oversized artifacts out of task JSON and stores references only.
- Backend conformance tests shared by in-memory, SQLite, and future durable stores.
