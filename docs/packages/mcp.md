# @a2amesh/mcp

`@a2amesh/mcp` provides mapping helpers and a bridge layer to integrate Model Context Protocol (MCP) clients and servers with the A2A Mesh protocol.

## Purpose

- **A2A ↔ MCP Bridge**: Translates bounded MCP tool calls into A2A discovery, message, and task operations.
- **Standalone Distribution**: Publishes the `a2amesh-mcp` stdio command and `@a2amesh/mcp/server` API.
- **Auditable Safety**: Implements audit logging hooks and telemetry propagation across MCP tool execution.
- **Execution Guardrails**: Enforces audience, principal, scope, tenant, consent, tool, and outbound-network policy before bridge calls.

## Installation

```bash
npm install @a2amesh/mcp
```

## Standalone MCP server

Start the published alpha package without a global install:

```bash
npx -y -p @a2amesh/mcp a2amesh-mcp --transport stdio
```

Use one of the product-owned runtime examples in the repository root. The examples
start read-only with `a2a_discover` and `a2a_get_task`, reject localhost and private
networks, and contain no concrete credentials. Add `a2a_send_message` only after an
explicit approval has produced a scoped `A2AMESH_MCP_SEND_APPROVAL_ID`.

Repeatable automation should pin the exact released package version instead of the
moving `alpha` tag.

## Usage Example

```typescript
import { handleA2AMcpToolCall } from '@a2amesh/mcp';

const result = await handleA2AMcpToolCall(
  {
    agentUrl: 'https://agent.example.com',
    name: 'reviewer',
    description: 'Reviews a scoped change',
    security: {
      requestId: 'request-42',
      tenantId: 'tenant-a',
      expectedTenantId: 'tenant-a',
      authContext: {
        subject: 'operator-7',
        audience: 'urn:mcp:a2a-bridge',
        scopes: ['mcp:tools'],
      },
      audiencePolicy: { expectedAudience: 'urn:mcp:a2a-bridge' },
      requiredScopes: ['mcp:tools'],
      authorityPolicy: { auditPolicy: { allowedTools: ['reviewer'] } },
      consent: { decision: 'approved', approvalId: 'approval-42' },
      outboundPolicy: { allowedHostnames: ['agent.example.com'] },
      audit(event) {
        auditSink.write(event);
      },
    },
  },
  { message: 'Review the staged patch.' },
);
```

Calls without a security policy, mismatched tenants, missing authorization,
unapproved consent, unsafe arguments, or disallowed destinations are denied before
network access. Audit events contain hashes and policy evidence, not raw prompts,
tokens, subjects, or provider error text.

## Release State

- **Channel**: Public Alpha
- **Initial Version**: `0.1.0-alpha.0`
