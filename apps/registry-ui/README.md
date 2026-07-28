# a2amesh Registry UI

A single-page operator console for the A2A Mesh registry.

## Features

- **Five views:** Fleet table, topology graph, task stream, dry-run playground, and conformance dashboard
- **Explicit effective context:** authentication method, tenant claim, visibility scope, and health-staleness budget from the registry
- **Two access modes:** authenticated/operator control plane and readonly public discovery, with anonymous operator access called out separately
- **Trust and freshness signals:** verified, unverified, rejected, or missing Agent Card evidence plus current, stale, or never-observed health data
- **Live updates** via Server-Sent Events for agent registration and task events
- **Filtering** by status, capability, tenant, and search
- **No external services required** — runs with any A2A Mesh registry instance

## Quick start

```bash
# Install dependencies
pnpm install

# Start the dev server (connects to localhost:3099 by default)
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

The dev server proxies `/api` to `http://localhost:3099` so it works out of the box with a local registry started via `pnpm run dev:smoke` from the monorepo root.

## Operator inspector demo flow

Use the fleet table or topology graph to select an agent. The inspector panel shows:

- Agent Card metadata, transport, tenant, visibility, capabilities, and skills
- Registry signature-verification state and failure reason without exposing credentials or token claims
- Structured health reason, freshness state, and remediation hints for degraded, unknown, or stale agents
- Quick actions to copy the Agent Card, export operator config, open latest-task replay context, and review conformance

For demos, seed at least one healthy public agent and one failing private agent so the health reason panel demonstrates both normal and remediation states.

## Connecting to a remote registry

Set the `VITE_REGISTRY_URL` environment variable to point to a registry instance:

```bash
VITE_REGISTRY_URL=https://registry.example.com pnpm run dev
```

When `VITE_REGISTRY_URL` is set, the dev server proxy is bypassed and API calls go directly to the remote URL.

## Access modes

| Effective mode                | Condition                                                        | Visible scope and controls                                                  |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Authenticated operator**    | Registry validates API key, bearer JWT, or OIDC identity         | Tenant-and-public or all-agent scope; CRUD, task stream, replay, SSE        |
| **Anonymous operator access** | Control plane is intentionally configured without authentication | All visible records and operator actions, with an explicit security warning |
| **Readonly public discovery** | Private listing returns 401/403 and public discovery is enabled  | Public agents only; no mutation, private task stream, or privileged SSE     |

The UI obtains this information from the sanitized `/context` endpoint. It does not infer authentication from a successful agent-list response and does not render raw claims, roles, scopes, or credentials. A 401/403 from the private listing triggers the explicit public list and public context endpoints; other context failures are surfaced instead of silently assuming a mode.

## Technology

- React 19, TypeScript 6, Vite 8
- Tailwind CSS 4 (CSS-first configuration via `@import 'tailwindcss'`)
- Server-Sent Events for live data
- Vitest (unit tests), Playwright (E2E + accessibility)
