# Fleet Control Plane Server

`@a2amesh/internal-fleet-server` provides the authenticated HTTP control plane used
by the Mission Control operator UI. It serves live worker health, task routing, an
approval queue for gated side effects, artifact review, tenant-scoped live events,
and an append-only audit timeline.

See [ADR-0012](../architecture/adr/0012-fleet-control-plane-server.md) for the design
rationale and [Provider Workers and Mission Control Plan](provider-workers-mission-control.md)
for the supported integration boundaries.

## Status

This is an internal workspace package. It is not published to npm and is not a
stable public API.

## Security model

Fleet is a privileged control-plane surface. Production mode is fail-closed:

- `security.mode: 'production'` requires a configured `auth` provider.
- The listener binds to `127.0.0.1` by default.
- An unauthenticated server cannot bind to a non-loopback interface.
- Browser CORS is disabled unless exact origins are listed in
  `security.allowedOrigins`.
- Wildcard CORS origins are rejected.
- Request-body `actor` values are ignored. Audit identity always comes from the
  verified principal.
- Runs, audit entries, worker visibility, and SSE events are tenant-scoped.
- High-risk self-approval is disabled unless explicitly enabled.

Development mode permits a synthetic local administrator only for loopback
workflows and tests. Do not use development mode as an external deployment model.

### Production example

```typescript
import { FleetControlPlaneServer } from '@a2amesh/internal-fleet-server';

const server = new FleetControlPlaneServer({
  registryUrl: 'http://127.0.0.1:3099',
  host: '127.0.0.1',
  security: {
    mode: 'production',
    allowedOrigins: ['https://mission-control.example.com'],
    allowHighRiskSelfApproval: false,
  },
  auth: {
    securitySchemes: [
      {
        id: 'fleet-api-key',
        type: 'apiKey',
        in: 'header',
        name: 'x-fleet-key',
      },
    ],
    apiKeys: {
      'fleet-api-key': {
        value: process.env.FLEET_API_KEY ?? '',
        principalId: 'mission-control-operator',
        tenantId: 'tenant-a',
        roles: ['operator'],
      },
    },
  },
});

server.start(3200);
```

OIDC and signed bearer JWTs use the same `JwtAuthMiddlewareOptions` contract. JWT
or API-key credentials should provide a stable `principalId`, optional `tenantId`,
and Fleet roles. Worker credentials must also carry a `workerId` or `worker_id`
claim matching the run's assigned worker.

## Role and permission matrix

Permissions may be granted by a Fleet role or directly as scopes. The
`fleet:*` scope grants all Fleet permissions.

| Role            | Read workers/runs | Route | Approve/reject | Complete assigned run | Cancel | Audit/events | All tenants |
| --------------- | ----------------- | ----- | -------------- | --------------------- | ------ | ------------ | ----------- |
| `viewer`        | Yes               | No    | No             | No                    | No     | Yes          | No          |
| `worker`        | Runs only         | No    | No             | Yes                   | No     | Events       | No          |
| `operator`      | Yes               | Yes   | No             | No                    | Yes    | Yes          | No          |
| `approver`      | Yes               | No    | Yes            | No                    | No     | Yes          | No          |
| `administrator` | Yes               | Yes   | Yes            | Yes                   | Yes    | Yes          | Yes         |

The concrete permission names are:

- `fleet:workers:read`
- `fleet:runs:read`
- `fleet:runs:route`
- `fleet:runs:approve`
- `fleet:runs:complete`
- `fleet:runs:cancel`
- `fleet:audit:read`
- `fleet:events:read`

## Tenant isolation

A non-administrator principal can only see or mutate resources whose `tenantId`
matches the verified authentication context. A request cannot override its tenant by
supplying another `tenantId` in the route body. Cross-tenant run and audit lookups
return `404` to avoid leaking resource existence.

Administrators can access all tenants. Tenant-scoped SSE clients receive only events
for their tenant; administrator clients may receive all events.

Workers discovered without a tenant list are treated as shared candidates. Workers
with an explicit tenant list are visible and routable only to matching principals.

## Separation of duties

`remote-write`, `publish`, and `deploy` runs require approval. By default, the
principal that requested one of these high-risk runs cannot approve it, even when the
principal has both `operator` and `approver` roles. Set
`security.allowHighRiskSelfApproval: true` only for an explicitly accepted local
policy exception.

Approval and rejection use an atomic storage transition. Repeating the same
decision returns the existing run without another audit entry or capacity update.
Conflicting concurrent decisions for the same pending run result in one successful
terminal decision and one `409` conflict.

## Storage backends

`FleetControlPlaneServerOptions.storage` accepts any `IFleetStorage` implementation:

- `InMemoryFleetStorage` is intended for tests and single-process development.
- `SqliteFleetStorage` persists runs and audit entries, uses WAL mode, and performs
  approval/rejection transitions inside `BEGIN IMMEDIATE` transactions.

Run and audit storage includes an indexed tenant identifier. Existing SQLite files
are upgraded through schema migration version 2.

```typescript
import { FleetControlPlaneServer, SqliteFleetStorage } from '@a2amesh/internal-fleet-server';

const server = new FleetControlPlaneServer({
  registryUrl: 'http://127.0.0.1:3099',
  storage: new SqliteFleetStorage('./fleet.db'),
  security: { mode: 'production' },
  auth: productionAuthOptions,
});
```

See [ADR-0014](../architecture/adr/0014-sqlite-persistence-for-trust-log-and-fleet-storage.md)
for the persistence rationale.

Worker registration remains the registry's responsibility. Fleet Server does not
expose a second worker-registration endpoint; the registry must enforce its own
authentication and tenant policy.

## Routes

`GET /health` is a public liveness endpoint. Every `/fleet` route requires
authentication and an explicit permission.

| Method | Path                        | Required permission   | Purpose                                            |
| ------ | --------------------------- | --------------------- | -------------------------------------------------- |
| GET    | `/fleet/workers`            | `fleet:workers:read`  | Tenant-visible worker health and capacity.         |
| POST   | `/fleet/tasks/route`        | `fleet:runs:route`    | Route a task and create a run.                     |
| GET    | `/fleet/runs`               | `fleet:runs:read`     | List tenant-visible runs.                          |
| GET    | `/fleet/runs/:id`           | `fleet:runs:read`     | Fetch one tenant-visible run.                      |
| GET    | `/fleet/runs/:id/artifacts` | `fleet:runs:read`     | List validated run artifacts.                      |
| POST   | `/fleet/runs/:id/approve`   | `fleet:runs:approve`  | Atomically approve a pending run.                  |
| POST   | `/fleet/runs/:id/reject`    | `fleet:runs:approve`  | Atomically reject a pending run.                   |
| POST   | `/fleet/runs/:id/complete`  | `fleet:runs:complete` | Complete an assigned run and submit artifacts.     |
| POST   | `/fleet/runs/:id/cancel`    | `fleet:runs:cancel`   | Cancel a pending or running run.                   |
| GET    | `/fleet/audit`              | `fleet:audit:read`    | Read the tenant-scoped append-only audit timeline. |
| GET    | `/fleet/events`             | `fleet:events:read`   | Open a tenant-scoped Server-Sent Events stream.    |

### Approval example

```bash
curl -X POST http://127.0.0.1:3200/fleet/runs/<runId>/approve \
  -H 'x-fleet-key: <approver credential>' \
  -H 'content-type: application/json' \
  -d '{}'
```

The server records the verified principal as the audit actor. Sending an `actor`
field cannot change the recorded identity.

## Routing and concurrency

`POST /fleet/tasks/route` calls `routeFleetTask` using only candidates visible to the
principal's tenant. High-risk or explicitly gated work starts as `PENDING`; other
work starts as `RUNNING`.

The server tracks active run counts and updates them only after successful atomic
state transitions. Completing or canceling a running run releases the worker slot.

## Artifact review

`POST /fleet/runs/:id/complete` validates all submitted artifacts before the atomic
completion transition. Unknown kinds, missing provenance, or unsafe unredacted
content are rejected with `400` and the run remains active.

## Audit timeline

State-changing actions append sequence-numbered entries with verified `actor` and
`tenantId` values:

- `task-routed`
- `run-pending-approval`
- `run-approved`
- `run-rejected`
- `artifact-added`
- `run-completed`
- `run-failed`
- `run-canceled`

## Verification commands

```bash
pnpm --filter @a2amesh/internal-fleet-server run test
pnpm --filter @a2amesh/internal-fleet-server run typecheck
pnpm run test:integration
pnpm run security
pnpm run lint:md
pnpm run docs:build
```
