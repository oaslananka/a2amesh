---
name: a2a-mcp-consumption
description: Configure and consume the bounded A2A Mesh MCP bridge without exposing unrestricted tools, credentials, or network access.
---

# A2A MCP Consumption

Use this skill to connect an MCP-capable client to the repository-owned compatibility bridge and invoke only its reviewed A2A tool surface.

## When to use

Use this skill when the user asks to:

- connect a local MCP client to A2A Mesh through stdio or loopback Streamable HTTP;
- discover the bounded MCP tool set;
- diagnose MCP connection or tool-registration failures; or
- invoke `a2a_discover`, `a2a_send_message`, or `a2a_get_task` under the documented policy.

This is not an OpenClaw-specific plugin and does not make OpenClaw, Claude Code, or any other client part of the A2A protocol implementation.

## Required context

Confirm:

- the repository checkout and built `examples/openclaw-mcp` compatibility server;
- the transport: stdio or loopback Streamable HTTP;
- the exact tool allowlist;
- expected tenant, audience, scopes, and approval identifiers;
- named credential variables already provided by the runtime secret source;
- statically allowlisted A2A agents and destinations; and
- the requested read-only or state-changing tool invocation.

## Workflow

1. Read `examples/openclaw-mcp/README.md` and ADR-0016 before configuring a client.
2. Prefer stdio for a local one-user flow. Use Streamable HTTP only on loopback with the documented bearer transport credential.
3. Configure exactly `a2a_discover`, `a2a_send_message`, and `a2a_get_task`; do not widen the allowlist.
4. Run the client's status, doctor, or probe command before any tool call.
5. Start with `a2a_discover` for the expected tenant.
6. Use `a2a_get_task` only for a known allowlisted agent and task.
7. Obtain explicit approval before `a2a_send_message` and pass the configured approval identifier.
8. Preserve audit evidence and report bounded reason codes without exposing input or output secrets.

## Safety boundaries

- Fail closed on tool, tenant, audience, scope, approval, agent, and destination mismatch.
- Keep SSRF and outbound-network restrictions enabled.
- Never expose terminal, credential, merge, publish, deployment, or destructive tools through this bridge.
- Do not place concrete credentials in plugin files, client configuration committed to Git, logs, audit payloads, or chat output.
- Treat MCP annotations as hints; server authorization and audit policy remain authoritative.
- Bound timeout, cancellation, response size, and task artifact output.
- Do not claim generic MCP or A2A conformance from one client probe.

## Failure modes

Stop and report the bounded reason code when:

- the MCP server cannot start or the client cannot negotiate the transport;
- a requested tool is outside the allowlist;
- tenant, audience, scope, or approval checks fail;
- an agent is unavailable or its destination violates outbound policy;
- the operation times out or is canceled;
- audit emission fails; or
- returned content cannot be safely redacted.

## Output format

Return:

- Client and transport context
- Registered tool allowlist
- Tenant, audience, scope, and approval posture
- Probe or doctor evidence
- Tool invocation result
- Audit evidence pointers
- Failure reason codes
- Redaction and privacy notes
- Safe rollback step
