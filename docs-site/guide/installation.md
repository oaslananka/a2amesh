# Installation

Install the runtime:

```bash
pnpm add @a2amesh/runtime
```

Run the standalone MCP server without a global install:

```bash
npx -y -p @a2amesh/mcp@alpha a2amesh-mcp --transport stdio
```

The product-owned client examples are read-only by default. Replace their placeholder tenant and endpoint with an authorized target, and keep concrete credentials in the runtime secret source.
