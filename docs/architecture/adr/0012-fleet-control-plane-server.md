# ADR-0012: Fleet Control Plane Server

## Status

Accepted.

## Context

`docs/fleet/provider-workers-mission-control.md` and `docs/fleet/control-plane.md`
describe Mission Control as an operator surface that "may expose: worker health;
routing evidence; approval queue; artifact review; audit timeline; incident handoff;
manual runbooks," but `docs/fleet/roadmap.md` states Mission Control is not yet
implemented. Before this ADR, that was true for a deeper reason than "no UI exists
yet": no HTTP surface anywhere in the repository served Fleet domain data at all.
`packages/fleet` and `packages/worker-runtime` are pure in-process TypeScript
libraries with zero server code; `packages/registry`'s routes
(`packages/registry/src/server/routes.ts`) have no Fleet-aware endpoints;
`FleetApprovalGate`, `FleetPolicyDecision`, `FleetRoutingDecision`, and
`MissionControlPlan` existed only as type definitions in
`packages/fleet/src/types/domain.ts` plus their own unit-test literals. `apps/registry-ui`'s
existing "Fleet table" view is the registry's list of registered A2A agents — a UI
label, unrelated to `packages/fleet`'s domain model. A Mission Control UI therefore
had nothing real to render.

## Decision

### New package: `packages/fleet-server` (`@a2amesh/internal-fleet-server`)

An Express HTTP server, internal/private like `packages/fleet` and
`packages/worker-runtime` (no `public-surface.json`, no release-please manifest entry
— not yet a stable public API). It depends on `@a2amesh/internal-fleet` (routing,
artifact validation, domain types) and `@a2amesh/runtime` (registry client, rate
limiting, JWT auth, logger), mirroring `packages/registry`'s existing security
baseline rather than inventing a new one.

### Worker health: reuses W12's `RegistryWorkerDirectory` directly

`FleetControlPlaneServer` constructs a `RegistryWorkerDirectory`
(`@a2amesh/internal-fleet`, from the registry-backed-discovery work) pointed at a
configured `registryUrl`, or accepts a pre-built `FleetWorkerDirectory` directly
(`options.directory`) so tests and non-registry deployments never need a real HTTP
registry. `GET /fleet/workers` is therefore live, registry-backed data from day one,
not a mock.

### Runs are the dispatch/approval unit; storage is pluggable

A `FleetRunRecord` (`packages/fleet-server/src/storage/IFleetStorage.ts`) tracks one
routed task: the selected worker, `FleetRunStatus`, `FleetApprovalState`, the
originating `FleetRoutingDecision`, and accumulated `FleetArtifactRecord`s (the
Fleet-specific plan/diff/patch/test-output contract from
`packages/fleet/src/artifact-contracts/FleetArtifacts.ts` — not the generic A2A
`ExtensibleArtifact` message-part shape, since Fleet's own artifact kinds are what
"artifact review" means here). `IFleetStorage` is a storage-swap interface matching
the pattern already established by `@a2amesh/runtime`'s `ITaskStorage` and
`@a2amesh/registry`'s `IAgentStorage`; `InMemoryFleetStorage` is the only
implementation today. A durable backend can implement the same interface without
touching `FleetControlPlaneServer` or its routes.

### Approval queue: an HTTP-layer decision, not a `routeFleetTask` concern

`routeFleetTask` (existing, unchanged) already supports `approvedForRiskLevels` on a
candidate, but wiring "requires human approval" through it would make every
registry-discovered candidate permanently ineligible for gated risk levels (the
registry has no concept of pre-approved risk levels). Instead, `POST
/fleet/tasks/route` calls `routeFleetTask` to find the best candidate
unconditionally, then decides — at the HTTP layer — whether the resulting run starts
`RUNNING` immediately or `PENDING` awaiting `POST /fleet/runs/:id/approve` /
`/reject`, based on the caller's `requiresApproval` flag or a high `riskLevel`
(`remote-write`/`publish`/`deploy`, matching `FleetSideEffectLevel`'s existing
high-risk tier). This keeps the approval gate an operator-facing control-plane
concern, separate from capability/concurrency routing.

### Concurrency: the server's own run bookkeeping is authoritative, not the directory's

`RegistryWorkerDirectory` accepts an `activeRunCounts` callback (from W12), but that
callback only reflects reality when the directory itself is a
`RegistryWorkerDirectory` — a directly injected `FleetWorkerDirectory` (e.g.
`StaticWorkerDirectory` in tests) has no way to know about runs this server created.
`listCandidatesWithLiveRunCounts` (`server/routes.ts`) overrides each candidate's
`activeRunCount` with the server's own live `Map<workerId, count>`, incremented on
dispatch and decremented on completion, before every routing decision and every
`GET /fleet/workers` response. This makes concurrency enforcement correct regardless
of which directory implementation backs a given deployment.

### Audit timeline: append-only, not retroactively editable

Every state-changing action (`task-routed`, `run-pending-approval`, `run-approved`,
`run-rejected`, `artifact-added`, `run-completed`, `run-failed`) appends a
`FleetAuditEntry` with a monotonic `sequence` — the same append-only, sequence-numbered
shape as `@a2amesh/runtime`'s SQLite task audit journal, reimplemented here in-memory
rather than shared, since that journal is SQLite-storage-specific and Fleet runs are
not `Task`s.

### What this explicitly does not do (see `provider-workers-mission-control.md`)

No browser session scraping, no private provider token extraction, no automatic
subscription bypass, no side effect without an explicit `POST /fleet/runs/:id/approve`
when `requiresApproval`/a high risk level applies. "Incident handoff" and "manual
runbooks" from Mission Control's capability list remain operator process/documentation
concerns, not endpoints — the audit timeline gives an operator the evidence a runbook
would consume, but this server does not automate the runbook itself.

## Consequences

Mission Control now has a real API to render: `GET /fleet/workers` (health),
`POST /fleet/tasks/route` + the routing decision embedded in the response (routing
evidence), `GET /fleet/runs`, `POST /fleet/runs/:id/approve`/`/reject` (approval
queue), `GET /fleet/runs/:id/artifacts` (artifact review), `GET /fleet/audit` (audit
timeline), and `GET /fleet/events` (SSE for live updates). `InMemoryFleetStorage`
means run/approval/audit state does not survive a server restart — acceptable for a
first operator-facing surface, a known limitation to close before this graduates
past internal/private status.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
pnpm --filter @a2amesh/internal-fleet-server run test
pnpm run test:integration
```

Relevant coverage:

- [`InMemoryFleetStorage tests`](../../../packages/fleet-server/tests/InMemoryFleetStorage.test.ts)
- [`FleetControlPlaneServer route tests`](../../../packages/fleet-server/tests/FleetControlPlaneServer.test.ts)
- [`Fleet control-plane vs. a real registry integration test`](../../../tests/integration/fleet-control-plane.test.ts)

### Security hardening amendment (2026-07)

The control plane now treats authentication and authorization as an explicit trust
boundary. Production mode requires `JwtAuthMiddleware` configuration, the listener
binds to loopback by default, browser CORS uses an exact allowlist, and every
`/fleet` route declares a Fleet permission. Verified principals supply audit actor
identity and tenant scope; request-body actor values have no authority.

The role model separates viewer, worker, operator, approver, and administrator
responsibilities. High-risk self-approval is disabled by default. Run and audit
records carry tenant identity, SSE delivery is tenant-aware, and pending approval or
rejection uses an atomic storage transition so concurrent decisions cannot both
succeed. Worker registration remains owned by the registry rather than adding a
second registration authority to Fleet Server.
