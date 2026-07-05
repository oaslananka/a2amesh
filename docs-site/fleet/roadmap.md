# Fleet Roadmap

The Fleet roadmap outlines the trajectory for integrating fleet capabilities into A2A Mesh across milestones M0 to M5. This document focuses on the fleet-specific additions. For general protocol and ecosystem standards, refer to our existing cross-cutting epics.

## Existing Standards (Cross-References)

We adhere strictly to established A2A Mesh standards for these capabilities:

- **Architecture**: See [ADR-0009: Fleet Architecture](/guide/architecture) and [Fleet Control Plane Architecture](/fleet/control-plane).
- **Conformance**: See [Protocol Compatibility](/protocol/compliance) for A2A conformance fixture versioning.
- **Security**: See the [Threat Model](/security/threat-model) and [Fleet Policy, Sandbox, Artifact, and Approval Boundaries](/fleet/policy-sandbox-artifacts) and [Provider Workers and Mission Control Plan](/fleet/provider-workers-mission-control) for trust boundaries, approvals, and artifact controls.
- **Release**: See the [Release Process](/release/process) for publishing mechanics and artifact expectations.

## Implementation status

- **M1 (Worker Runtime)**: `WorkerRuntimeContract` (`packages/worker-runtime/src/types/lifecycle.ts`) has two reference implementations — `MockWorkerRuntimeAdapter` and `LocalCliWorkerRuntimeAdapter` — covering the full prepare/start/stream/observe/verify/finalize/cancel/cleanup lifecycle. See the [Quickstart](/fleet/quickstart).
- **M2 (Policy, Artifacts, Sandboxed Execution)**: `routeFleetTask`/`planFleetDispatchWaves` (`packages/fleet/src/routing/TaskRouter.ts`) implement capability/workspace/risk/concurrency-aware routing and dependency-aware dispatch planning; `validateFleetArtifact` (`packages/fleet/src/artifact-contracts/FleetArtifacts.ts`) implements the standardized artifact contract; `LocalCliWorkerRuntimeAdapter` implements command allowlisting, environment allowlisting, and workspace containment as the first sandboxed local execution surface.
- **M3 (Registry-backed worker discovery)**: `FleetWorkerDirectory` (`packages/fleet/src/discovery/WorkerDirectory.ts`) is the candidate-source contract consumed by `routeFleetTask`/`planFleetDispatchWaves`. `StaticWorkerDirectory` preserves the original in-memory-array behavior; `RegistryWorkerDirectory` (`packages/fleet/src/discovery/RegistryWorkerDirectory.ts`) queries a live `@a2amesh/registry` instance on a bounded refresh interval, evicts unhealthy or stale-heartbeat workers, and falls back to the last known-good candidate set when the registry is unreachable. See [Registry-backed worker discovery](/fleet/quickstart#registry-backed-worker-discovery).
- Remote/cloud adapters and Mission Control are not yet implemented.

## Milestones

### Fleet M0 — Scope, Architecture, and Governance

- Establish foundational architecture and agent metadata.
- Initial definitions of Fleet agent capabilities.
- Define Fleet package boundaries.

### Fleet M1 — Domain Model, Worker Runtime, and Registry

- Implement basic Fleet message structures and schemas.
- Introduce inter-agent communication data models.
- Support basic routing metadata.

### Fleet M2 — Policy, Artifacts, and Sandboxed Execution

- Build local execution environments for Fleet workers.
- Add generic provider adapters tailored for Fleet interactions.
- Enable single-node multi-agent testing.

### Fleet M3 — OpenCode, OpenRouter, and Local Issue Workflows

- Develop distributed task dispatch mechanisms.
- Extend the registry for dynamic Fleet discovery.
- Enhance matching strategies for specialized Fleet roles.

### Fleet M4 — Multi-Agent Review Chains and Mission Control

- Audit inter-agent communication channels.
- Expand conformance fixtures with Fleet-specific multi-agent scenarios.
- Fortify boundaries as outlined in the Threat Model.

### Fleet M5 — Claude, Codex, Gemini, and IDE Worker Integrations

- Stabilize API surfaces across all Fleet packages.
- Finalize documentation and end-to-end examples.
- Official release aligned with standard release processes.

## Architecture and Non-goals

See [ADR-0009: Fleet Architecture](/guide/architecture) and [Fleet Control Plane Architecture](/fleet/control-plane) for the integration boundaries, provider-neutral core, and human approval for external side effects.
