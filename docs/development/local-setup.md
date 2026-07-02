# Local setup

## Requirements

- Node.js matching the root `engines.node` range.
- Corepack enabled.
- pnpm matching the root `packageManager` field.

## Setup

```bash
pnpm run setup
```

## Common checks

```bash
pnpm run lint
pnpm run typecheck
pnpm run test:unit
pnpm run docs:check
```

## Full verification

```bash
pnpm run verify
```

The full verification path is intentionally heavy. It can exceed short interactive tool timeouts because it runs build, typecheck, coverage, integration tests, package checks, docs, security, ops, structure, and garbage-collection checks.

## Troubleshooting

Read `docs/troubleshooting.md` for known local environment and runtime issues.
