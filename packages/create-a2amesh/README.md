# @a2amesh/create-a2amesh

Scaffolds a new A2A Mesh agent project or production golden path demo.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Scaffolding a custom agent

```bash
pnpm dlx @a2amesh/create-a2amesh my-agent
```

## Scaffolding the credential-free production golden path

```bash
pnpm dlx @a2amesh/create-a2amesh my-demo --template production-demo
cd my-demo
pnpm install
pnpm dev
# In another terminal:
pnpm verify
```
