# @a2amesh/mcp

`@a2amesh/mcp` provides mapping helpers and a bridge layer to integrate Model Context Protocol (MCP) clients and servers with the A2A Mesh protocol.

## Purpose

- **A2A ↔ MCP Bridge**: Translates MCP tool calls and resources into A2A messages and task invocations.
- **Auditable Safety**: Implements audit logging hooks and telemetry propagation across MCP tool execution.
- **Execution Guardrails**: Enforces audience, principal, scope, tenant, consent, tool, and outbound-network policy before bridge calls.

## Installation

```bash
npm install @a2amesh/mcp
```

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
