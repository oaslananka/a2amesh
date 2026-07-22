# ADR-0003: Monorepo coverage policy

## Status

Accepted.

## Context

The original coverage configuration listed a subset of package roots directly in `vitest.config.ts`.
That list could become stale without failing and omitted active first-party packages such as protocol,
MCP, Fleet, Fleet server, telemetry, and worker runtime. A single aggregate percentage therefore did
not describe the complete monorepo and allowed a well-tested package to hide a regression in a
smaller security-sensitive package.

## Decision

`coverage-policy.json` is the canonical coverage inventory and threshold policy.

- Every active `packages/*` workspace with runtime TypeScript source must appear exactly once.
- Missing package roots, stale package entries, missing critical files, and undocumented exclusions
  fail `pnpm run coverage:inventory:check`.
- Vitest derives its include patterns, exclusions, and aggregate thresholds from the policy instead
  of maintaining a second list.
- `pnpm run test:coverage` enforces aggregate, package-level, and critical-file floors.
- Critical security and protocol files have explicit branch floors so aggregate coverage cannot hide
  regressions in those paths.
- The package report identifies packages touched by the current diff. Changed packages must still
  satisfy their package floor; unchanged packages are also checked to keep the repository baseline
  reproducible.
- CI publishes `coverage/package-summary.json` and `coverage/package-summary.md`, appends the Markdown
  report to the job summary, and uploads both files as an artifact.

The policy covers source files under all active package roots. Type declarations, tests, generated
build output, and generated CLI metadata are excluded with reasons recorded in the policy. Runtime
source is not excluded merely to improve a percentage.

## Consequences

Adding or removing a runtime package requires an intentional policy update. Threshold changes are
reviewable data changes rather than hidden Vitest configuration edits. Package and critical-file
floors can be ratcheted upward independently as targeted tests are added, while Codecov remains an
informational visualization layer rather than a duplicate blocking gate.

## Verification

```bash
pnpm run coverage:inventory:check
pnpm run test:coverage
```

The generated JSON report is the machine-readable source for automation. The Markdown report is the
human-readable CI and local summary.
