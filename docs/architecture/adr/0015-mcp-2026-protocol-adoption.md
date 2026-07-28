# ADR-0015: MCP 2026-07-28 protocol adoption gate

- Status: Accepted for pre-adoption compatibility evidence
- Date: 2026-07-28
- Decision owners: A2A Mesh maintainers

## Context

`@a2amesh/mcp` currently publishes against `@modelcontextprotocol/sdk ^1.29.0` and
uses the 2025-era MCP connection model. The split TypeScript SDK `2.0.0` exposes
the `2026-07-28` protocol path, including `server/discover`, stateless requests,
per-request metadata, HTTP method and tool-name headers, cache hints, and revised
authentication behavior.

Adopting that path directly would change connection bootstrap, request identity,
transport metadata, and error handling. The MCP bridge also has existing
fail-closed audience, principal, tenant, scope, consent, tool-policy, guardrail,
audit, and outbound-network boundaries that must remain authoritative.

## Decision

1. The published dependency range remains `@modelcontextprotocol/sdk ^1.29.0`.
   Stable MCP behavior and required CI continue to use that path.
2. The `2026-07-28` contract is represented by a versioned matrix and golden
   fixtures under `tests/conformance/fixtures/mcp-2026-07-28/`. These fixtures
   are part of the required conformance suite.
3. Split SDK packages are tested only in
   `tests/compat/mcp-2026-07-28/sdk-v2/`. That harness is private, pins every SDK
   package to `2.0.0`, and owns an independent lockfile so it cannot change the
   workspace or public package dependency graph.
4. CI runs the exact SDK harness as a report-only compatibility lane. Its result
   is visible in the job summary but is not included in `CI / required-summary`.
   A mismatch therefore records migration evidence without weakening or
   replacing the stable required lane.
5. MCP tasks and MCP Apps remain separate optional evaluations. A2A task support
   does not imply MCP task-extension support, and no application resource surface
   is registered by this decision.
6. Roots, sampling, logging, and other deprecated server-request flows are not
   introduced. Any modern input-required workflow needs a separate security and
   product review.

## Final adoption gate

The modern path may become supported only in a later reviewed change that:

- verifies the final specification publication and compatible SDK release;
- reruns the versioned fixtures, exact SDK probe, consumer smoke, and all existing
  MCP authorization, audit, credential-boundary, and outbound-policy tests;
- updates this ADR from pre-adoption to the chosen support posture;
- changes the public dependency range deliberately;
- adds migration and release notes without claiming unsupported extensions; and
- names a rollback release or revert that restores the stable SDK path.

## Rollback

Before final adoption, rollback is deletion of the report-only job and isolated
harness; the published package remains unchanged. After any future adoption, the
rollback is a revert of the dependency-range and modern transport changes while
retaining the versioned fixtures as regression evidence.

## Consequences

- Compatibility assumptions are explicit and executable before production
  adoption.
- Candidate SDK failures remain visible without destabilizing stable support.
- The repository carries a small additional test lockfile, but it is scoped to a
  real CI consumer and does not enter release artifacts.
- Support for `2026-07-28`, tasks, or MCP Apps is not implied by this ADR.
