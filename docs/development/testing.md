# Testing

Use the narrowest relevant command first, then run `pnpm run verify` before pushing. Unit,
integration, conformance, package, documentation, security, and coverage checks form the local gate.

## Coverage policy

Coverage is enforced by `pnpm run test:coverage`. The canonical inventory and floors live in
`coverage-policy.json`; `vitest.config.ts` consumes that policy rather than maintaining package paths
independently.

The inventory validator fails when an active runtime package is missing, a removed package remains,
a configured root does not exist, a critical file is missing, or an exclusion lacks a reason:

```bash
pnpm run coverage:inventory:check
```

```powershell
pnpm run coverage:inventory:check
```

A coverage run writes:

- `coverage/lcov.info` and `coverage/coverage-summary.json` for standard tooling;
- `coverage/package-summary.json` for automation;
- `coverage/package-summary.md` for local review and the GitHub Actions step summary.

Every active first-party package is measured. Package floors prevent a large package from masking a
regression in a smaller package. Critical protocol and security files have separate branch floors.
Packages touched by the current Git diff are marked in the report and must satisfy the same
repository-owned floor as the full inventory.

## Commands

Linux, macOS, and PowerShell use the same package scripts:

```bash
pnpm run test:unit
pnpm run test:integration
pnpm run test:conformance
pnpm run test:coverage
pnpm run docs:check
pnpm run security
pnpm run pack:dry-run
pnpm run verify
```

```powershell
pnpm run test:unit
pnpm run test:integration
pnpm run test:conformance
pnpm run test:coverage
pnpm run docs:check
pnpm run security
pnpm run pack:dry-run
pnpm run verify
```

Performance smoke thresholds are enforced with Grafana k6:

```bash
pnpm run perf:smoke
```

```powershell
pnpm run perf:smoke
```

Longer manual load checks use:

```bash
pnpm run perf:load
```

```powershell
pnpm run perf:load
```

The smoke profile starts local A2A server and registry instances, runs bounded threshold checks, and
does not require external services.
