# a2amesh Mission Control

The operator console for `@a2amesh/internal-fleet-server`'s Fleet control plane — live
worker health, task routing, an approval queue for gated side effects, artifact
review, and an audit timeline. See [Fleet Control Plane Server](../../docs/fleet/control-plane-server.md)
for the API this UI consumes and [ADR-0012](../../docs/architecture/adr/0012-fleet-control-plane-server.md)
for the design rationale.

## Features

- **Worker health** — live capabilities, roles, and active/max concurrency per worker
- **Task routing** — route a task by required capabilities and risk level, with an
  optional operator-approval gate
- **Approval queue** — approve/reject runs held `PENDING` for a gated side effect,
  right from the runs table
- **Artifact review** — inspect the standardized Fleet artifacts (plan, diff, patch,
  test-output, ...) a run produced
- **Audit timeline** — the append-only sequence of routing/approval/completion
  events for any run
- **Live updates** via Server-Sent Events (run and approval state changes)

## Quick start

```bash
# Install dependencies
pnpm install

# Start the dev server (connects to localhost:3200 by default)
pnpm run dev

# Build for production
pnpm run build

# Run unit tests
pnpm run test

# Run accessibility tests
pnpm run test:a11y

# Run E2E smoke tests
pnpm run test:e2e
```

The dev server proxies `/api` to `http://localhost:3200`, so it works out of the box
with a local `FleetControlPlaneServer` instance:

```typescript
import { FleetControlPlaneServer } from '@a2amesh/internal-fleet-server';

new FleetControlPlaneServer({ registryUrl: 'http://127.0.0.1:3099' }).start(3200);
```

## Connecting to a remote Fleet control plane

Set the `VITE_FLEET_URL` environment variable to point elsewhere:

```bash
VITE_FLEET_URL=https://fleet.example.com pnpm run dev
```

## Technology

- React 19, TypeScript 6, Vite 8
- Tailwind CSS 4 (CSS-first configuration via `@import 'tailwindcss'`)
- Server-Sent Events for live run/approval updates
- Vitest (unit tests), Playwright (E2E + accessibility)
