# MCP Bridge Example

This example maps an A2A agent into an MCP tool definition and maps an MCP tool back into an A2A skill. It supplies the required tenant, authorization, consent, and outbound policy. The smoke test uses a local fetch mock, so no MCP server or remote agent is required.

## Run

```bash
pnpm --dir examples/mcp-bridge run smoke
```

PowerShell:

```powershell
pnpm --dir examples/mcp-bridge run smoke
```

## Files

- `src/index.ts` demonstrates A2A-to-MCP and MCP-to-A2A mapping helpers.
- `tests/smoke.test.ts` verifies the tool schema, skill mapping, and mocked tool call output.
- `.env.example` documents the agent URL used by the mapping example.
