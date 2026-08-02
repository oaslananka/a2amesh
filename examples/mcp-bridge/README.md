# MCP Bridge and Fleet Worker Example

This example keeps the existing A2A-to-MCP and MCP-to-A2A mapping proof and adds a policy-backed Fleet worker that invokes one documented MCP tool through an injected client. The smoke test uses local fakes, so no MCP server, remote agent, network access, or credentials are required.

The worker path validates a `FleetProviderWorkerPlan` and task-bound read-only admission, invokes only the allowlisted `repo.read` tool, and requires a SHA-256 checksummed artifact before verification passes.

## Run

```bash
pnpm --dir examples/mcp-bridge run smoke
```

PowerShell:

```powershell
pnpm --dir examples/mcp-bridge run smoke
```

## Files

- `src/index.ts` demonstrates A2A/MCP mapping helpers and the `McpWorkerRuntimeAdapter` lifecycle.
- `tests/smoke.test.ts` verifies tool mapping, mocked A2A output, policy-backed MCP execution, credential-safe failure formatting, and checksummed artifact verification.
- `.env.example` documents the agent URL used by the mapping example. The Fleet worker fake needs no environment variables.
