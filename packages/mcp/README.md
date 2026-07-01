# @a2amesh/mcp

Mapping helpers for supported Agent2Agent and MCP tool shapes.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Boundary helpers

The MCP package keeps endpoint targeting and tool approval as separate decisions:

- `validateMcpAudience` checks that a caller context targets the selected MCP resource.
- `decideMcpRuntimeAuthority` checks whether the selected MCP tool is allowed, review-only, or denied by policy.
- `createMcpSafeAuditEvent` records request id, context hash, selected MCP server/tool, decision, reason code, and evidence pointers.

A caller context accepted for an MCP resource does not automatically approve every tool on that resource. Multi-audience contexts require an explicit selected MCP resource.
