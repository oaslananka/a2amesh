# @a2amesh/create-a2amesh

Scaffolds a new A2A Mesh agent project or production golden path demo.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Published stable (`0.18.2`) — custom agent

This workflow uses npm `latest` as of 10 October 2026. The older
published scaffold requires `npm install`: pnpm 11 rejects an
unapproved `esbuild` install script.

```bash
pnpm dlx @a2amesh/create-a2amesh@latest my-agent --adapter custom
cd my-agent
npm install
npm run build
npm run dev
```

## Prepared source (`0.19.0`) — credential-free production demo

**Not available from npm `latest` until the protected 0.19.0
release is actually published.** After publication and registry verification:

```bash
pnpm dlx @a2amesh/create-a2amesh@0.19.0 my-demo --template production-demo
cd my-demo
pnpm install
cp .env.example .env
pnpm dev
# In another terminal:
pnpm verify
```

The new generator adds a narrowly scoped pnpm build-script allowlist for
`esbuild`; it does not disable lifecycle-script protections.
