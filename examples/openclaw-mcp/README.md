# OpenClaw MCP Compatibility Example

This example proves that OpenClaw can consume a narrowly scoped A2A Mesh MCP server without adding an OpenClaw runtime dependency, a public plugin package, or unrestricted tools to A2A Mesh.

The required smoke test uses the official MCP TypeScript SDK as a fake OpenClaw-compatible consumer. It performs no external network request and needs no real credential. A separate real OpenClaw probe is opt-in.

## What the example proves

- The server exposes only `a2a_discover`, `a2a_send_message`, and `a2a_get_task`.
- The same tool surface works over stdio and Streamable HTTP.
- Tenant, audience, principal, per-tool scope, tool allowlist, approval, and destination policy checks fail closed.
- Agent endpoints come from an operator allowlist rather than MCP tool input.
- Credentials are resolved from named environment variables and are never accepted inline in the agent JSON.
- Tool inputs, principal identifiers, tokens, and credential-shaped output are absent from audit payloads and bounded errors.
- Required tests cover invalid input, unavailable agents, unsafe destinations, timeout, cancellation, and transport authentication.
- A real OpenClaw `status`/`doctor --probe`/`probe` lane is available without becoming required CI.

## Required fake-consumer smoke

```bash
pnpm --dir examples/openclaw-mcp run smoke
```

This runs an in-memory MCP client, a spawned stdio client, and a loopback Streamable HTTP client. Fake A2A operations verify all three tools without contacting an external agent.

## Configuration

Use a runtime secret manager as the source of real values. `.env.example` contains names and safe placeholders only.

| Variable                                | Required   | Purpose                                                                                                                    |
| --------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `A2AMESH_OPENCLAW_MCP_TRANSPORT`        | No         | `stdio` or `streamable-http`; defaults to Streamable HTTP in code and is set to `stdio` in the example file.               |
| `A2AMESH_OPENCLAW_MCP_HOST`             | HTTP only  | Loopback bind; only `127.0.0.1`, `localhost`, or `::1` is accepted by this spike.                                          |
| `A2AMESH_OPENCLAW_MCP_PORT`             | HTTP only  | Positive TCP port, default `3097`.                                                                                         |
| `A2AMESH_OPENCLAW_MCP_SERVER_TOKEN`     | HTTP only  | Bearer credential for the MCP transport. Keep it in the runtime secret manager; do not commit it to OpenClaw config.       |
| `A2AMESH_OPENCLAW_MCP_SERVER_NAME`      | Live only  | OpenClaw MCP registry entry name used by the opt-in probe; defaults to `a2amesh`.                                          |
| `A2AMESH_OPENCLAW_MCP_TENANT_ID`        | Yes        | Exact tenant allowed by the bridge.                                                                                        |
| `A2AMESH_OPENCLAW_MCP_AUDIENCE`         | Yes        | Exact MCP-facing credential audience.                                                                                      |
| `A2AMESH_OPENCLAW_MCP_CLIENT_ID`        | Yes        | Service principal identifier used by the bridge policy.                                                                    |
| `A2AMESH_OPENCLAW_MCP_SCOPES`           | Yes        | Comma-separated scopes. The three tools require `a2a:agents:read`, `a2a:messages:send`, and `a2a:tasks:read` respectively. |
| `A2AMESH_OPENCLAW_MCP_READ_APPROVAL_ID` | Read tools | Evidence that the operator approved the discovery/task-read policy.                                                        |
| `A2AMESH_OPENCLAW_MCP_SEND_APPROVAL_ID` | Send tool  | Evidence for the specific approved send policy. Absence blocks `a2a_send_message`.                                         |
| `A2AMESH_OPENCLAW_MCP_ALLOWED_TOOLS`    | Yes        | Explicit subset of the three supported tool names. Unknown names fail configuration.                                       |
| `A2AMESH_OPENCLAW_MCP_AGENTS_JSON`      | Yes        | JSON allowlist with `id`, `name`, `description`, `url`, and optional `tokenEnv`. Inline token fields are rejected.         |
| Agent credential variables              | As needed  | Variables referenced by `tokenEnv`, injected by the runtime secret manager only.                                           |
| `A2AMESH_OPENCLAW_MCP_TIMEOUT_MS`       | No         | Positive A2A operation timeout, default `30000`.                                                                           |
| `A2AMESH_OPENCLAW_LIVE`                 | Live only  | Must equal `1` before the real OpenClaw probe runs.                                                                        |
| `A2AMESH_OPENCLAW_BIN`                  | Live only  | OpenClaw executable, default `openclaw`.                                                                                   |

## Recommended OpenClaw registration: stdio

Build the workspace, then register the compiled server as a local stdio MCP server. Resolve absolute paths before saving the definition.

```bash
pnpm run build

openclaw mcp add a2amesh \
  --command /absolute/path/to/node \
  --arg /absolute/path/to/a2amesh/examples/openclaw-mcp/dist/src/index.js \
  --cwd /absolute/path/to/a2amesh \
  --include 'a2a_discover,a2a_send_message,a2a_get_task'
```

Run OpenClaw itself through the runtime secret manager so the child process inherits the A2A Mesh variables without writing credentials into OpenClaw-managed configuration:

```bash
secret-manager run -- openclaw mcp doctor a2amesh --probe
secret-manager run -- openclaw mcp probe a2amesh --json
```

The bridge writes operational messages to stderr; stdout remains reserved for the stdio MCP protocol.

## Streamable HTTP

Start the loopback-only HTTP server:

```bash
secret-manager run -- pnpm --dir examples/openclaw-mcp run start
```

The endpoint is `http://127.0.0.1:3097/mcp` by default and requires the configured bearer token. The required smoke test verifies both rejection without the token and successful MCP discovery with it.

Static HTTP bearer values should not be committed to OpenClaw configuration. Prefer stdio for this local spike. A future remote deployment would require reviewed TLS and an OAuth or secret-reference design before this example's loopback restriction could be relaxed.

## Real OpenClaw probe

OpenClaw documents `mcp doctor --probe` and `mcp probe` as live connection and capability checks. The opt-in command runs only read-only diagnostics against the already registered server:

```bash
secret-manager run -- env A2AMESH_OPENCLAW_LIVE=1 \
  pnpm --dir examples/openclaw-mcp run live:openclaw
```

The command executes:

```text
openclaw mcp status --verbose
openclaw mcp doctor a2amesh --probe --json
openclaw mcp probe a2amesh --json
```

Output is bounded and redacted before it is returned by the helper. A successful probe proves OpenClaw connectivity and tool discovery; it does not prove a production deployment or invoke an A2A agent.

An operator with configured OpenClaw model credentials and a reachable allowlisted A2A agent can perform a separate manual turn using OpenClaw's headless agent entry point. Keep the requested action explicit and limited to the three tools:

```bash
secret-manager run -- openclaw agent --local --json \
  --message "Use a2a_discover for tenant tenant-local. Do not call any other tool."
```

## Failure behavior

| Condition                                                   | Result                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Invalid or extra tool arguments                             | `mcp-invalid-tool-arguments`; no A2A operation runs.                  |
| Wrong tenant, audience, principal, scope, or tool allowlist | Authorization denial before A2A access.                               |
| Missing approval evidence                                   | `mcp-consent-required`.                                               |
| Unknown or cross-tenant agent                               | `mcp-agent-unavailable`.                                              |
| Local/private destination under the default policy          | `mcp-outbound-policy-denied`.                                         |
| Caller cancellation                                         | `mcp-operation-cancelled`.                                            |
| Operation timeout                                           | `mcp-operation-timeout`.                                              |
| Unexpected A2A failure                                      | `mcp-operation-failed`; underlying response details are not returned. |
| Audit sink failure                                          | `mcp-audit-failed`; the operation fails closed.                       |
| Missing HTTP bearer token                                   | HTTP `401` without token disclosure.                                  |

## Rollback

Remove the OpenClaw registry entry and rotate/revoke any dedicated credentials or approval identifiers:

```bash
openclaw mcp unset a2amesh
```

Stop the HTTP process if used. Removing this example does not change `@a2amesh/mcp`, the public A2A runtime API, the registry, or published package dependencies.

## Decision

The compatibility result is **go** for the native MCP integration path and **no-go** for a dedicated OpenClaw plugin, public package, or separate integration repository at this stage. The native OpenClaw MCP registry already supplies the required connection, diagnostics, and tool-filtering boundary. Revisit a plugin only if a product workflow needs behavior that cannot be expressed through standard MCP configuration and the demand is demonstrated.

See [ADR-0016](../../docs/architecture/adr/0016-openclaw-mcp-consumption.md) and the current [OpenClaw MCP documentation](https://docs.openclaw.ai/cli/mcp).
