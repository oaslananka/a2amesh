# ADR-0009: Fleet Architecture

## Status

Accepted

## Context

Before adding worker adapters, the repository needs a formal decision record that preserves the vendor-neutral A2A core while allowing Fleet orchestration packages above it.

## Decision

The Fleet architecture introduces a layered orchestration system built on top of the provider-neutral Agent2Agent (A2A) core.

### Package Boundaries

The following new packages define the Fleet orchestration capabilities:

- `packages/fleet`: The primary orchestration layer.
- `packages/worker-runtime`: Execution environment for individual workers.
- `packages/policy`: Rule and constraint definitions for fleet execution.
- `packages/artifacts`: Artifact storage and lifecycle management.
- Worker/provider adapter packages: Extensions for specific runtime or provider integrations.

The `packages/runtime` must remain strictly provider-neutral. No provider-specific code will be placed inside `packages/runtime`. The core package defines the universal protocol and runtime behavior.

### Concept Mapping

A2A concepts map to Fleet concepts as follows:

- **A2A Task**: Maps directly to Fleet tasks, which are dispatched to specific workers based on policy and availability.
- **A2A Artifact**: Maps to Fleet artifacts managed by the `packages/artifacts` system, providing persistent, addressable state.
- **A2A AgentCard**: Maps to Fleet workers, where the card defines the worker's capabilities and identity within the fleet registry.

### Extension Points and Integrations

Integrations with the Fleet architecture must use official API, CLI, or MCP surfaces. Direct internal hacking or unsupported extraction methods are not permitted.

### Non-goals

To maintain security, reliability, and clear boundaries, the following are explicit non-goals:

- No web UI scraping, browser session/token extraction, or subscription-limit bypassing.
- No provider-specific code inside `packages/runtime`.
- No remote push, publish, issue close, PR merge, or deploy operations without explicit human approval.

### Implementation note (2026-07-03)

The first routing (`routeFleetTask`, `planFleetDispatchWaves`) and artifact-contract
(`validateFleetArtifact`) implementations landed inside `packages/fleet` rather than as separate
`packages/policy`/`packages/artifacts` packages, to avoid adding new workspace packages (release
config, tsconfig references, package registry parity checks, etc.) before there is enough surface
area to justify the split. `packages/worker-runtime` gained its first two `WorkerRuntimeContract`
implementations (`MockWorkerRuntimeAdapter`, `LocalCliWorkerRuntimeAdapter`) in the same pass. This
does not change the package boundary decision above — extracting `packages/policy` and
`packages/artifacts` remains available once routing/policy or artifact-contract code grows large or
independent enough to warrant its own release cadence.

## Consequences

By keeping the core provider-neutral, we ensure the longevity and stability of the A2A protocol implementation. The Fleet packages can iterate quickly on orchestration, policy, and artifact management without risking the integrity of the core layer.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
```
