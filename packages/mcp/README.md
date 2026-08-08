# @a2amesh/mcp

Mapping helpers for supported Agent2Agent and MCP tool shapes.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Boundary helpers

The MCP package keeps endpoint targeting and tool approval as separate decisions:

- `validateMcpAudience` checks that a caller context targets the selected MCP resource.
- `decideMcpRuntimeAuthority` checks whether the selected MCP tool is allowed, review-only, or denied by policy.
- `createMcpSafeAuditEvent` records request id, context hash, selected MCP server/tool, decision, reason code, and evidence pointers.

A caller context accepted for an MCP resource does not automatically approve every tool on that resource. Multi-audience contexts require an explicit selected MCP resource.

## Installation

The supported prerelease channel is `alpha`:

```bash
npm install @a2amesh/mcp@alpha
```

The installed binary can print help without runtime credentials:

```bash
a2amesh-mcp --help
```

Repository contributors should run `corepack pnpm run build:clean` before executing the workspace
launcher directly from a source checkout.

## Standalone server

The package publishes a local MCP server command in addition to the library API:

```bash
npx -y -p @a2amesh/mcp@alpha a2amesh-mcp --transport stdio
```

The command reads only `A2AMESH_MCP_*` environment variables. The supported client
examples are `.mcp.json`, `.codex/config.example.toml`,
`.vscode/mcp.example.json`, and `opencode.example.jsonc` in the repository root.
They expose `a2a_discover` and `a2a_get_task` by default. Enabling
`a2a_send_message` also requires the send scope and a fresh, explicitly approved
`A2AMESH_MCP_SEND_APPROVAL_ID` for the session.

Agent credentials are referenced by `tokenEnv` inside `A2AMESH_MCP_AGENTS_JSON`;
concrete values stay in the process secret source. Localhost and private-network
destinations remain disabled unless the operator deliberately enables the matching
outbound-policy variables.

The reusable server APIs are exported from `@a2amesh/mcp/server`.

## Tool guardrails

The MCP package also provides execution guardrail helpers:

- `classifyMcpToolManifestRisk` scores tool, skill, and metadata text for policy, schema, side-effect, and metadata-risk findings.
- `decideMcpToolGuardrail` returns `allow`, `review`, or `block` with a reason code and evidence pointers.
- `createMcpDryRunPlan` builds a non-executing plan with input hashes and type-only previews.
- `createMcpGuardrailAuditEvent` emits a compact event for audit hooks without raw tool input values.

Use the guardrail decision before executing MCP tools. Tools that require human review or dry-run evidence should be surfaced to the caller or operator instead of executed directly.

## Secured A2A invocation

`handleA2AMcpToolCall` fails closed unless `security` is supplied. The execution
boundary validates the caller audience and principal, required scopes, tenant
identity, tool policy, guardrail result, and explicit consent evidence before any
network access. The outbound policy blocks localhost, private addresses, unsafe
schemes, and redirects unless the operator deliberately permits the target.

Audit hooks receive authorization and execution events containing hashes and
type-safe evidence only. Tokens, subjects, raw prompts, arguments, and provider
errors are not included. Local development endpoints therefore require an explicit
`outboundPolicy: { allowLocalhost: true }`; do not use that setting for untrusted
agent URLs.

The MCP bridge follows redirects only through the same validating policy used for the
initial target. DNS results are pinned to connection setup, response and SSE bodies are
bounded, and the operation deadline remains active through body consumption. JSON-RPC POST
requests are not retried without an explicit idempotency key.

## MCP 2026-07-28 compatibility evidence

The published package remains on `@modelcontextprotocol/sdk ^1.29.0` and does not
claim support for MCP `2026-07-28`. A versioned matrix and golden fixtures run in
the required conformance suite, while an isolated exact split-SDK `2.0.0` harness
checks `server/discover`, stateless tool discovery and invocation, modern headers,
cache hints, and a synthetic authentication boundary.

Run the repository-owned contract and the isolated SDK probe with:

```bash
pnpm run test:mcp-next
pnpm run mcp-next:probe
```

The SDK probe is pre-adoption evidence only. MCP tasks and MCP Apps remain separate
optional evaluations, and the existing bridge authorization and outbound policy
continue to be authoritative. See
[ADR-0015](../../docs/architecture/adr/0015-mcp-2026-protocol-adoption.md).
