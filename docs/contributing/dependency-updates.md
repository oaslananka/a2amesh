# Dependency update policy

A2A Mesh runs Renovate from `.github/workflows/renovate.yml`. The workflow is repository-owned, uses a full-SHA-pinned official Renovate action, and targets only `oaslananka/a2amesh`.
The workflow defaults to read-only repository access; write access to contents, issues, and pull requests is scoped only to the Renovate job.

## Schedule and manual runs

Renovate runs every Monday, Wednesday, and Friday at `03:23 UTC` (`06:23 Europe/Istanbul`) and can also be started through **Actions → Renovate → Run workflow**.

The workflow uses the repository `GITHUB_TOKEN`. Write access remains scoped to the Renovate job and is limited to:

- repository contents;
- issues and pull requests;
- workflow dispatches for required checks.

Read-only security-event access lets Renovate inspect vulnerability alerts. The workflow does not mount the Docker socket and does not receive publishing or deployment credentials.

GitHub intentionally suppresses `pull_request` workflow events for pull requests created with `GITHUB_TOKEN`. After Renovate finishes, `scripts/dispatch-renovate-checks.mjs` finds open `repository-managed-renovate/*` pull requests and dispatches the required CI, docs, security, CodeQL, Scorecard, and Dependency Review workflows on the exact head commit. The dispatcher verifies the head SHA before every dispatch and never deploys the documentation site.

## Dependency Dashboard

Renovate maintains a **Dependency Dashboard** issue. Use it to:

- approve major updates;
- inspect updates held by the three-day release-age policy;
- retry or rebase blocked updates;
- review vulnerability alerts;
- start an update that is intentionally pending.

Major updates are not created until a maintainer approves them in the Dashboard. No Renovate pull request is automerged. If `main` changes while a Renovate run is active, Renovate exits with `repository-changed`; rerun the workflow after `main` stabilizes so Dashboard and remaining branch updates can finish.

## Project-specific rules

- Internal `@a2amesh/*` packages are excluded. Release Please owns their linked versions.
- npm releases wait at least three days before a normal update is proposed.
- GitHub Actions and container dependencies remain pinned.
- Vitest, Hono, OpenTelemetry, registry UI, docs-site, and security-tool updates are grouped intentionally.
- Lockfile maintenance runs once per month.
- Security-tool versions in `.github/workflows/security.yml` are mapped by explicit regex managers; the workflow itself does not need inline Renovate annotations.
- Runtime versions remain governed by `tools/runtime-versions.json`. pnpm updates are grouped under the `pnpm toolchain` rule and run `scripts/check-runtime-versions.mjs --write` so workspace manifests, engine ranges, Docker arguments, generated scaffold metadata, documentation, and release preflight policy remain synchronized.
- Repository-owned unpublished GHCR images are excluded because they are produced by this repository rather than consumed from an external release stream.

## Local validation

Run the repository contract validator:

```bash
corepack pnpm run renovate:validate
```

Run Renovate's official strict validator with the repository-pinned version and Node 24:

```bash
docker run --rm --entrypoint renovate-config-validator \
  -v "$PWD/renovate.json:/renovate.json:ro" \
  ghcr.io/renovatebot/renovate:43.272.4 --strict /renovate.json
```

Preview missing required-check dispatches without starting workflows:

```bash
corepack pnpm run renovate:dispatch:plan
```

Configuration changes must also pass YAML, actionlint, zizmor, formatting, and the integration tests in `tests/integration/renovate-config.test.ts`, `tests/integration/renovate-dispatch.test.ts`, and `tests/integration/runtime-versions-script.test.ts`.

## Vulnerability updates

Vulnerability alerts use `priority:P1`, `type:security`, and `area:deps`. They remain visible independently of the routine update cadence. Review the advisory, affected dependency path, available fix, lockfile changes, and full CI evidence before merge.
