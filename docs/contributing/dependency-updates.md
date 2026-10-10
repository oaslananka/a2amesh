# Dependency update policy

A2A Mesh uses the **Mend-hosted Renovate GitHub App** as its sole dependency-update
producer for `oaslananka/a2amesh`. Renovate's configuration lives in
[`renovate.json`](../../renovate.json); the hosted service owns the schedule,
authentication, dependency branches and update pull requests. Do not re-enable
a second repository-managed Renovate GitHub Actions runner.

## Operational behavior

- The [hosted Dependency Dashboard](https://github.com/oaslananka/a2amesh/issues/348)
  is the canonical place to approve major upgrades, inspect waiting updates
  and review security fixes.
- Routine updates wait for a minimum **three-day release age**; major upgrades
  additionally require Dependency Dashboard approval.
- Limit normal work to **two open Renovate PRs, two active Renovate branches,
  two new PRs/hour and two commits/hour**. Security fixes can bypass upstream
  rate limits and remain subject to the full repository security review.
- Renovate does not automatically merge its own PRs. Mergify may merge eligible,
  stable, low-risk **npm devDependency patch** updates created by
  `renovate[bot]` on `renovate/*` only after protected exact-head checks pass.
  Major updates, runtime changes, GitHub Actions, Docker and security updates
  never inherit that approval.
- The hosted App can read GitHub Dependabot alerts when the repository's
  dependency graph, Dependabot alerts and App permission are enabled. Renovate's
  `vulnerabilityAlerts` and `osvVulnerabilityAlerts` are enabled; GitHub
  Dependabot security **PR generation remains disabled** to avoid duplicate
  PR producers.

## Workspace and release contracts

Internal `@a2amesh/*` packages are excluded: Release Please owns their linked
versions. Other package changes must preserve the canonical pnpm workspace
`link:` declarations, intentionally injected resolutions, exact direct package
pins and matching lockfile overrides. The
`CI / dependency-update` job runs on hosted `renovate/*` branches and performs
workspace checks, an isolated clean-store installation, documentation/GC
validation, a clean build, unit/integration tests and package dry-runs.
Ordinary `pull_request` workflows run directly for the hosted App; a
`GITHUB_TOKEN` PR-workflow approval/dispatch workaround is unnecessary.

### Maintainer-reviewed exceptional updates

Mend-hosted Renovate does **not** guarantee execution of this repository's
arbitrary `postUpgradeTasks`. No privileged `pull_request_target` checkout of
PR code or new secret-bearing bot is used as a workaround. Existing project
checks instead **fail closed** on inconsistent generated files.

- pnpm toolchain updates require explicit Dashboard approval. When an
  approved PR changes `tools/runtime-versions.json`, the maintainer must run
  `node scripts/check-runtime-versions.mjs --write` on that PR branch and
  include every generated version mirror before the protected CI can pass.
  This includes engine ranges, workflow Node versions, scaffold metadata,
  docs and Docker arguments. Do not bypass `check-runtime-versions` to merge.
- A reviewed security update affecting an existing
  `minimumReleaseAgeExclude` entry must reconcile that exact version-specific
  exception. The retained `scripts/sync-dependency-policy.mjs --write`
  helper consumes a **reviewed** `RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE`
  in the format documented in that script. Do not carry unrelated exceptions
  forward or invent a new exception to evade the three-day age policy.
  Security fixes without such exceptions need no special synchronization.

GitHub Actions and container versions remain pinned; Vitest, Hono,
OpenTelemetry, UI and documentation dependencies are grouped. The monthly
lockfile maintenance policy, security-tool regex managers and pinned Codecov
CLI mapping remain active. Repository-owned unpublished GHCR images are
excluded.

## Validation and operations

Validate the repository policy:

```bash
corepack pnpm run renovate:validate
```

The hosted App validates Renovate configuration changes itself. Review its
status checks and execution logs in the Mend Developer Portal, and verify CI
results on the exact PR head. Local JSON policy checks do not substitute for
the hosted service's validation.

Do not use `.github/workflows/renovate.yml` or
`renovate:dispatch:plan`: those belonged to the retired second runner. The
previous Actions-managed Dashboard
[#328](https://github.com/oaslananka/a2amesh/issues/328) is historical;
[#348](https://github.com/oaslananka/a2amesh/issues/348) remains active.

If a required quality/security job fails, inspect that failed job before
starting redundant CI. Only integrate with passing protected checks and the
configured Mergify queue.
