# Agent Plugin

A2A Mesh includes a product-owned, distribution-capable alpha plugin for endpoint validation, approved task operations, and security-bounded MCP consumption.

The public `@a2amesh/mcp` package provides the `a2amesh-mcp` stdio server. Product-owned examples cover Claude Code, Codex, VS Code, and OpenCode, and start with only `a2a_discover` and `a2a_get_task`. Catalog state is managed separately by `oaslananka/agent-tools` after release-artifact validation.

## Validate locally

```bash
node scripts/check-agent-plugin.mjs
pnpm run mcp:distribution:check
claude plugin validate --strict .
```

Use the canonical [agent plugin plan](https://github.com/oaslananka/a2amesh/blob/main/docs/agent-plugin.md) for installation, send approval, upgrade, rollback, and catalog activation gates.
