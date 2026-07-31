# Agent Plugin

A2A Mesh includes a product-owned, skills-only alpha plugin for endpoint validation, approved task operations, and security-bounded MCP consumption.

The plugin is intentionally not active in the public agent-tools catalog. Its current support matrix, non-goals, install and rollback procedures, validation commands, and activation gates are maintained in the canonical [agent plugin plan](https://github.com/oaslananka/a2amesh/blob/main/docs/agent-plugin.md).

## Validate locally

```bash
node scripts/check-agent-plugin.mjs
claude plugin validate --strict .
```

The local plugin does not automatically launch an MCP server. The bounded MCP workflow requires the repository-owned compatibility example and its documented policy.
