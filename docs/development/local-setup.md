# Local setup

## Requirements

- Node.js matching an entry in `tools/runtime-versions.json`.
- Corepack enabled.
- pnpm matching the root `packageManager` field.

`mise.toml` is the default Node.js bootstrap. mise owns Node.js; Corepack and the root `packageManager` field own pnpm.

## Setup

Linux/macOS:

```bash
mise trust
mise install
mise reshim
corepack pnpm run toolchain:check
corepack pnpm run setup
```

PowerShell:

```powershell
mise trust
mise install
mise reshim
corepack pnpm run toolchain:check
corepack pnpm run setup
```

Without mise, install a supported Node.js version, run `corepack enable`, and use the same explicit `corepack pnpm` commands.

## Common checks

Linux/macOS:

```bash
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test:unit
corepack pnpm run docs:check
```

PowerShell:

```powershell
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test:unit
corepack pnpm run docs:check
```

## Full verification

Linux/macOS:

```bash
corepack pnpm run verify
```

PowerShell:

```powershell
corepack pnpm run verify
```

The full verification path is intentionally heavy. It can exceed short interactive tool timeouts because it runs build, typecheck, coverage, integration tests, package checks, docs, security, ops, structure, and garbage-collection checks.

## Troubleshooting

When direct `pnpm` resolves through a stale external shim, run the doctor through Corepack first. mise users should then run `mise trust && mise install && mise reshim`; other contributor environments should run `corepack enable`. Read-only automation hosts can run `node scripts/run-pnpm.mjs run verify`, which supplies an ephemeral Corepack-backed pnpm shim to nested scripts. Read `docs/troubleshooting.md` for additional local environment and runtime issues.
