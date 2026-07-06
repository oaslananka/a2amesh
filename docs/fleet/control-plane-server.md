# Fleet Control Plane Server

`@a2amesh/internal-fleet-server`'s `FleetControlPlaneServer` is the first HTTP surface
serving Fleet domain data: live worker health, task routing, an operator approval
queue for gated side effects, artifact review, and an append-only audit timeline —
the server-side surface the Mission Control operator UI (`apps/mission-control`)
consumes. See [ADR-0012](../architecture/adr/0012-fleet-control-plane-server.md) for
the design rationale and [Provider Workers and Mission Control Plan](provider-workers-mission-control.md)
for the capability/non-goal boundaries this server respects.

## Mission Control UI

`apps/mission-control` is a Vite/React operator console for this API (`apps/mission-control/README.md`):
worker health, a task-routing form, the approval queue (approve/reject actions inline
in the runs table), and per-run artifact/audit review, with live updates over
`GET /fleet/events`. It proxies `/api` to a local `FleetControlPlaneServer` on port
`3200` by default; point it elsewhere with `VITE_FLEET_URL`.

## Status

Internal workspace package (`packages/fleet-server`), not published to npm, not a
stable public API.

## Starting a server

```typescript
import { FleetControlPlaneServer } from '@a2amesh/internal-fleet-server';

const server = new FleetControlPlaneServer({
  registryUrl: 'http://127.0.0.1:3099', // a running @a2amesh/registry instance
});
server.start(3200);
```

## Storage backends

`FleetControlPlaneServerOptions.storage` accepts any `IFleetStorage` implementation:

- `InMemoryFleetStorage` (default) — run, approval, and audit state do not survive a
  process restart. Suitable for a single-instance deployment or tests.
- `SqliteFleetStorage` — durable, file-backed via Node's built-in `node:sqlite`. Each
  `FleetRunRecord` is a JSON blob alongside indexed `status`/`approvalState`/`createdAt`
  columns; the audit timeline is a dedicated append-only, sequence-numbered table.

```typescript
import { FleetControlPlaneServer, SqliteFleetStorage } from '@a2amesh/internal-fleet-server';

const server = new FleetControlPlaneServer({
  registryUrl: 'http://127.0.0.1:3099',
  storage: new SqliteFleetStorage('./fleet.db'),
});
server.start(3200);
```

See [ADR-0014](../architecture/adr/0014-sqlite-persistence-for-trust-log-and-fleet-storage.md)
for the design rationale.

Worker discovery reuses `RegistryWorkerDirectory` from the
[registry-backed worker discovery](quickstart.md#registry-backed-worker-discovery)
work — workers register themselves with the registry the same way any A2A agent
does; this server never invents its own worker-registration path. For tests or a
non-registry deployment, inject a `FleetWorkerDirectory` directly instead of
`registryUrl`:

```typescript
import { StaticWorkerDirectory } from '@a2amesh/internal-fleet';

const server = new FleetControlPlaneServer({
  directory: new StaticWorkerDirectory([
    /* FleetRoutingCandidate[] */
  ]),
});
```

## Routes

| Method | Path                        | Purpose                                                                    |
| ------ | --------------------------- | -------------------------------------------------------------------------- |
| GET    | `/health`                   | Liveness check.                                                            |
| GET    | `/fleet/workers`            | Live worker health (capabilities, roles, tenants, active/max concurrency). |
| POST   | `/fleet/tasks/route`        | Routes a task to a candidate worker; creates a `FleetRunRecord`.           |
| GET    | `/fleet/runs`               | Lists runs, optionally filtered by `status` or `approvalState`.            |
| GET    | `/fleet/runs/:id`           | Fetches one run.                                                           |
| POST   | `/fleet/runs/:id/approve`   | Approves a `PENDING` run; transitions it to `RUNNING`.                     |
| POST   | `/fleet/runs/:id/reject`    | Rejects a `PENDING` run; transitions it to `FAILED`.                       |
| POST   | `/fleet/runs/:id/complete`  | Reports `COMPLETED`/`FAILED` with validated `FleetArtifactRecord`s.        |
| GET    | `/fleet/runs/:id/artifacts` | Lists a run's artifacts.                                                   |
| GET    | `/fleet/audit`              | Append-only audit timeline, optionally filtered by `runId`.                |
| GET    | `/fleet/events`             | Server-Sent Events stream of run/approval updates.                         |

## Routing and the approval queue

`POST /fleet/tasks/route` always calls `routeFleetTask` first to find the best
eligible worker for the requested capabilities/workspace scope, regardless of risk.
The resulting run then starts in one of two states:

- **`status: 'RUNNING'`, `approvalState: 'NOT_REQUIRED'`** — the default, when the
  request does not set `requiresApproval` and `riskLevel` (if given) is not
  `remote-write`/`publish`/`deploy`.
- **`status: 'PENDING'`, `approvalState: 'PENDING'`** — when the caller sets
  `requiresApproval: true`, or `riskLevel` is one of the high-risk tiers. The
  proposed worker is recorded on the run, but the worker's active-run slot is not
  consumed until an operator calls `/approve`.

```bash
curl -X POST http://127.0.0.1:3200/fleet/tasks/route \
  -H 'content-type: application/json' \
  -d '{"taskId": "task-1", "requiredCapabilities": ["code-review"], "riskLevel": "publish"}'
# -> { "decision": {...}, "run": { "status": "PENDING", "approvalState": "PENDING", ... } }

curl -X POST http://127.0.0.1:3200/fleet/runs/<runId>/approve \
  -H 'content-type: application/json' \
  -d '{"actor": "operator-1"}'
# -> { "status": "RUNNING", "approvalState": "APPROVED", ... }
```

If routing finds no eligible worker at all, `run` is `null` and `decision.reason`
explains why (matching `routeFleetTask`'s existing fail-closed behavior — no
guessing, no partial dispatch).

## Concurrency accounting

The server tracks each worker's active run count itself (incremented on dispatch,
decremented on `/complete`) and overrides whatever the configured
`FleetWorkerDirectory` reports before every routing decision and every
`GET /fleet/workers` response. This keeps concurrency limits correct even when a
directly injected directory (e.g. `StaticWorkerDirectory` in tests) has no way to
know about runs this server created.

## Artifact review

`POST /fleet/runs/:id/complete` validates every submitted artifact with
`validateFleetArtifact` (`@a2amesh/internal-fleet`) before accepting it — unknown
kind, missing provenance, or unredacted credential-shaped content is rejected with a
`400` and the run is left unchanged. Accepted artifacts use the standardized Fleet
kinds: `plan`, `diff`, `patch`, `file-change-summary`, `command-log`, `test-output`,
`review-comment`, `security-finding`, `pr-metadata`, `release-evidence`.

## Audit timeline

Every state-changing action appends a sequence-numbered `FleetAuditEntry`:
`task-routed`, `run-pending-approval`, `run-approved`, `run-rejected`,
`artifact-added`, `run-completed`, `run-failed`. `GET /fleet/audit?runId=<id>` scopes
the timeline to one run; the sequence is monotonic and never reused.

## Security defaults

`FleetControlPlaneServer` reuses `@a2amesh/runtime`'s existing security primitives
rather than inventing new ones: CORS, a configurable rate limiter
(`createRateLimiter`/`InMemoryRateLimitStore`), and optional JWT/API-key
authentication (`JwtAuthMiddleware`) scoped to the `/fleet` path when `options.auth`
is configured. As with the rest of the workspace, run this behind authentication
in any non-loopback deployment.

## Verification commands

```bash
pnpm --filter @a2amesh/internal-fleet-server run test
pnpm run test:integration
pnpm run verify:structure
```
