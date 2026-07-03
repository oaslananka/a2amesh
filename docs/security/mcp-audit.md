# MCP audit workflow

The MCP bridge treats tool metadata, arguments, caller credentials, and outbound
destinations as separate untrusted inputs. Its A2A invocation path fails closed
before network access unless every boundary decision succeeds.

## Helpers

| Helper                           | Purpose                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `auditMcpTool`                   | Scores a tool definition and returns findings.                                       |
| `decideMcpToolApproval`          | Converts findings into `allow`, `review`, or `block`.                                |
| `createAllowedMcpTools`          | Produces the tool names that may be exposed.                                         |
| `evaluateMcpBridgeAuthorization` | Combines audience, principal, scope, tenant, tool, guardrail, and consent decisions. |
| `createMcpBridgeAuditEvent`      | Emits redacted authorization and outcome evidence.                                   |

## Policy inputs

The audit policy supports allowed tools, blocked tools, approval-required tools, sensitive keywords, and maximum description length.

Use this layer before mapping MCP tools into A2A skills. Registry, CLI, and operator workflows can store the audit result alongside the mapped skill so reviewers can understand why a tool is allowed, blocked, or sent to review.

## Enforcement order

1. Reject malformed or oversized arguments.
2. Require a stable request ID and an exact tenant-policy match.
3. Require a subject or client principal, the selected audience, and configured scopes.
4. Apply the tool allow/block policy and metadata guardrails.
5. Require explicit consent with an approval evidence ID, including review-class tools.
6. Validate every outbound URL, deny unsafe schemes/addresses, and reject redirects.
7. Record the authorization decision and final outcome.

The audit contract stores tenant and request identifiers, the selected tool, reason
codes, evidence pointers, and SHA-256 hashes. It deliberately excludes raw tool
arguments, prompts, subjects, bearer tokens, and provider error messages. Operators
must isolate audit storage by tenant and apply their normal retention/access policy.

Localhost or private-network agent targets are blocked by default. Operators may
enable them only for a trusted local mesh using explicit outbound policy; arbitrary
user-provided destinations must never inherit that exception.
