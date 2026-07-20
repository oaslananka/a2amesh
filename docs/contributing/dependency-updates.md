# Dependency update policy

A2A Mesh runs Renovate from `.github/workflows/renovate.yml`. The workflow is repository-owned, uses a full-SHA-pinned official Renovate action, and targets only `oaslananka/a2amesh`.

## Schedule and manual runs

Renovate runs every Monday, Wednesday, and Friday at `03:23 UTC` (`06:23 Europe/Istanbul`) and can also be started through **Actions → Renovate → Run workflow**.

The workflow uses the repository `GITHUB_TOKEN` with only these write permissions:

- repository contents;
- issues;
- pull requests.

It does not mount the Docker socket and does not receive publishing or deployment credentials.

GitHub can place CI runs from pull requests created with `GITHUB_TOKEN` into an approval-required state. A maintainer must approve those runs from the pull request before merge. This is intentional: the repository does not reuse a broad personal access token only to bypass that control.

## Dependency Dashboard

Renovate maintains a **Dependency Dashboard** issue. Use it to:

- approve major updates;
- inspect updates held by the three-day release-age policy;
- retry or rebase blocked updates;
- review vulnerability alerts;
- start an update that is intentionally pending.

Major updates are not created until a maintainer approves them in the Dashboard. No Renovate pull request is automerged.

## Project-specific rules

- Internal `@a2amesh/*` packages are excluded. Release Please owns their linked versions.
- npm releases wait at least three days before a normal update is proposed.
- GitHub Actions and container dependencies remain pinned.
- Vitest, Hono, OpenTelemetry, registry UI, docs-site, and security-tool updates are grouped intentionally.
- Lockfile maintenance runs once per month.
- Security-tool versions in `.github/workflows/security.yml` are discovered from `# renovate:` annotations.
- Runtime versions remain governed by `tools/runtime-versions.json` and `scripts/check-runtime-versions.mjs`; Renovate must not change one runtime pin independently.

## Local validation

Run the repository contract validator:

```bash
corepack pnpm run renovate:validate
```

Run Renovate's official strict validator with the repository-pinned version and Node 24:

```bash
npx --yes --package=renovate@43.272.4 renovate-config-validator --strict renovate.json
```

Configuration changes must also pass YAML, actionlint, zizmor, formatting, and the integration test in `tests/integration/renovate-config.test.ts`.

## Vulnerability updates

Vulnerability alerts use `priority:P1`, `type:security`, and `area:deps`. They remain visible independently of the routine update cadence. Review the advisory, affected dependency path, available fix, lockfile changes, and full CI evidence before merge.
