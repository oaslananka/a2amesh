# ADR-0016: OpenClaw consumes A2A Mesh through bounded native MCP

- Status: Accepted
- Date: 2026-07-31
- Decision owners: A2A Mesh maintainers

## Context

OpenClaw can save and probe third-party MCP servers through its native MCP client registry. A2A Mesh already has fail-closed MCP audience, principal, tenant, scope, consent, tool-policy, audit, credential, and outbound-network boundaries. The repository did not have an executable proof that OpenClaw could consume those capabilities without coupling A2A Mesh core packages to OpenClaw.

A dedicated plugin or public package would introduce another release, compatibility, installation, credential, and support surface. It is not justified when the standard MCP path can expose the required workflows.

## Decision

1. OpenClaw integration uses the native MCP client-registry path documented by OpenClaw. It does not treat OpenClaw internal agent routing as A2A protocol conformance.
2. The compatibility example exposes exactly `a2a_discover`, `a2a_send_message`, and `a2a_get_task` through MCP SDK `1.29.x`.
3. Stdio is the recommended local transport. Streamable HTTP is supported only on loopback with a required bearer token in this spike.
4. Agent destinations are an operator-owned static allowlist. MCP callers cannot supply arbitrary URLs.
5. Tenant, audience, principal, per-tool scope, tool allowlist, approval evidence, outbound policy, timeout, cancellation, and secret-safe audit checks remain authoritative and fail closed.
6. Required CI uses fake A2A operations plus official MCP SDK consumers over in-memory, stdio, and Streamable HTTP transports. It does not install OpenClaw or require an external service.
7. Real OpenClaw verification is opt-in and limited to `status`, `doctor --probe`, and `probe`. It records connection and tool-discovery evidence without making OpenClaw a required dependency.
8. The decision is **go** for native MCP consumption and **no-go** for a dedicated OpenClaw plugin, public A2A Mesh package, or separate repository now.

## Plugin reconsideration gate

Reconsider a dedicated plugin only when all of the following are true:

- a concrete user workflow cannot be represented through the standard MCP server definition and tool filter;
- repeated external demand is documented;
- plugin installation, upgrade, rollback, compatibility, and security ownership are assigned;
- clean-environment validation and failure recovery are automated; and
- the new surface does not duplicate product behavior already owned by `a2amesh`.

## Consequences

- OpenClaw compatibility is executable without entering the A2A Mesh runtime dependency graph.
- The example adds a maintained integration surface, but it remains private and is covered by the existing example smoke suite.
- Operators must supply explicit approvals and scopes even for read tools; convenience does not weaken the policy boundary.
- Streamable HTTP is not approved for non-loopback deployment by this decision.
- A successful probe is interoperability evidence, not a production certification.

## Rollback

Run `openclaw mcp unset a2amesh`, stop any example server process, and rotate or revoke the dedicated credentials and approval identifiers. A repository rollback is a revert of the example, documentation, and this ADR; no public package API or released dependency needs to change.

## Validation Commands

```bash
pnpm --dir examples/openclaw-mcp run smoke
pnpm run examples:smoke
pnpm run lint:md
pnpm run docs:build
```

The optional real lane requires an installed OpenClaw binary and operator-managed configuration:

```bash
secret-manager run -- env A2AMESH_OPENCLAW_LIVE=1 \
  pnpm --dir examples/openclaw-mcp run live:openclaw
```

References:

- [OpenClaw MCP client registry](https://docs.openclaw.ai/cli/mcp)
- [OpenClaw headless agent execution](https://docs.openclaw.ai/cli/agent)
