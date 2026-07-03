# @a2amesh/internal-fleet

Agent2Agent Fleet domain model, orchestration types, task routing, and artifact contracts for the Local Agent Mesh.

This package contains the core types for FleetWorker, FleetTask, FleetRun, and orchestration strategy surfaces, plus:

- `routeFleetTask` / `planFleetDispatchWaves` (`src/routing/TaskRouter.ts`): policy-aware, deterministic task-to-worker routing and dependency-aware dispatch planning.
- `validateFleetArtifact` (`src/artifact-contracts/FleetArtifacts.ts`): the standardized coding-agent artifact contract (plan, diff, patch, file-change-summary, command-log, test-output, review-comment, security-finding, pr-metadata, release-evidence) with provenance and redaction enforcement.

See the [Local Agent Mesh Quickstart](../../docs/fleet/quickstart.md) for a runnable end-to-end example.

## Status

This is an internal workspace package. It is private, not published to npm, not part of the first public alpha install surface, and not a stable public API.

## Workspace usage

This package is consumed inside the A2A Mesh monorepo through workspace dependencies. Do not install it directly from npm.

If provider SDK dependencies are needed for local development, install them through the workspace using the root pnpm workflow.

## Compatibility

See the workspace [Compatibility](../../docs/compatibility.md) matrix for supported Node.js and pnpm versions.
