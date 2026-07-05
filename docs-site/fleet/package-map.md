# Fleet Package Map

This document defines the package boundaries, dependency directions, and architectural responsibilities for Fleet capabilities within the A2A Mesh ecosystem.

## Dependency Direction

To maintain a clean and acyclic architecture, Fleet packages must adhere to the following dependency flow (from lowest level to highest level):

```text
packages/runtime (and types) -> packages/fleet (core fleet protocols) -> worker packages -> provider adapter packages -> packages/fleet-server (control-plane HTTP surface) -> applications/CLI
```

- Lower-level packages **must never** import from higher-level packages.
- Dependencies should be kept to a minimum; always prefer relying on `packages/runtime` public APIs when possible.

## Package Boundaries & Responsibilities

### `packages/runtime`

A2A runtime/protocol only. Must remain strictly provider-neutral.

- **Belongs Here:** Standard A2A protocol types, `A2AServer`, `A2AClient`, basic task and state management, base security (auth/URL policies), and universal telemetry.
- **Does NOT Belong Here:** `packages/worker-*` and `packages/adapter-*` packages must stay above core and must not be imported by `packages/runtime`.

### `packages/registry`

- **Belongs Here:** Discovery, health, capability records, future Worker Cards.

### `packages/fleet`

- **Belongs Here:** Orchestration, domain model, strategy surfaces.

### `packages/worker-runtime`

- **Belongs Here:** Provider-neutral worker lifecycle contracts.

### `packages/policy`

- **Belongs Here:** Execution guardrails and approval/budget policy.

### `packages/artifacts`

- **Belongs Here:** Run artifacts, reports, diffs, logs, reviews, handoff outputs.

### `packages/fleet-server`

- **Belongs Here:** The control-plane HTTP surface (`FleetControlPlaneServer`): live worker health, task routing, the operator approval queue, artifact review, and the audit timeline. See [Fleet Control Plane Server](/fleet/control-plane-server) and [ADR-0012](/guide/architecture).

### Worker & Provider Adapter Packages

Packages designed to interface with specific runtime environments or LLM providers (e.g., `packages/adapter-openai`, `packages/worker-*`).

- **Does NOT Belong Here:** Core protocol logic, fleet orchestration algorithms, or cross-provider routing rules.

### Applications

- `apps/mission-control` is the operator UI above packages.

## Architecture and Non-goals

See [ADR-0009: Fleet Architecture](/guide/architecture) and [Fleet Control Plane Architecture](/fleet/control-plane) for the integration boundaries. Crucially:

- `packages/runtime` is provider-neutral.
- Direct internal hacking or unsupported extraction methods are not permitted.
- Human approval is required for external side effects (e.g., remote push, publish, issue close, PR merge, deploy). See [Fleet Policy, Sandbox, Artifact, and Approval Boundaries](/fleet/policy-sandbox-artifacts) and [Provider Workers and Mission Control Plan](/fleet/provider-workers-mission-control).

## Additional Rules

- **No Circular Dependencies:** A strict DAG (Directed Acyclic Graph) must be enforced.
- **Public API Exports:** All cross-package interactions must occur via explicitly declared exports. Deep imports into another package's internals are strictly forbidden.
