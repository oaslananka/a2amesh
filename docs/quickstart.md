# Quickstart

## Scaffold a project

pnpm:

```bash
pnpm dlx @a2amesh/create-a2amesh@alpha demo
cd demo
pnpm install
pnpm run dev
```

npm:

```bash
npm exec @a2amesh/create-a2amesh@alpha -- demo
cd demo
npm install
npm run dev
```

yarn:

```bash
yarn dlx @a2amesh/create-a2amesh@alpha demo
cd demo
yarn install
yarn run dev
```

PowerShell:

```powershell
pnpm dlx @a2amesh/create-a2amesh@alpha demo
Set-Location demo
pnpm install
pnpm run dev
```

The generated project uses `@a2amesh/runtime` and optional adapters when templates are selected.

## Try the CLI

Install the CLI globally:

```bash
pnpm add --global @a2amesh/cli@alpha
```

After you have an agent running, check its health:

```bash
a2amesh health http://localhost:41234
```

Discover its agent card:

```bash
a2amesh discover http://localhost:41234
```

Send a message:

```bash
a2amesh send http://localhost:41234 --text "Hello agent"
```

## Start a local registry

```bash
a2amesh registry start --port 3099
```

See `a2amesh registry --help` for subcommands.

## Examples

For deployment-mode examples that run without paid external services, see [Examples](examples.md).
