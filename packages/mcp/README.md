# @a2amesh/mcp

Mapping helpers for supported Agent2Agent and MCP tool shapes.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Boundary helpers

The MCP package keeps endpoint targeting and tool approval as separate decisions:

- `validateMcpAudience` checks that a caller context targets the selected MCP resource.
- `decideMcpRuntimeAuthority` checks whether the selected MCP tool is allowed, review-only, or denied by policy.
- `createMcpSafeAuditEvent` records request id, context hash, selected MCP server/tool, decision, reason code, and evidence pointers.

A caller context accepted for an MCP resource does not automatically approve every tool on that resource. Multi-audience contexts require an explicit selected MCP resource.

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
