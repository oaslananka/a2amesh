# Quick Start

## Installable from npm today (0.18.2)

As verified on 10 October 2026, the published stable package generates a
custom agent, not the new `production-demo` template.

```bash
pnpm dlx @a2amesh/create-a2amesh@latest demo --adapter custom
cd demo
npm install
npm run build
npm run dev
```

The published scaffold does not provide `pnpm verify`. Its older pnpm
11 configuration may reject `esbuild` build scripts, so
`npm install` is used here.

## Prepared 0.19.0 release

The source tree prepares the two-agent credential-free production demo. This
command is **not installable from npm** until 0.19.0 is published and verified:

```bash
pnpm dlx @a2amesh/create-a2amesh@0.19.0 demo --template production-demo
cd demo
pnpm install
cp .env.example .env
pnpm dev
# In another terminal:
pnpm verify
```
