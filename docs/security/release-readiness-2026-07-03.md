# Release Readiness Evidence — 2026-07-03 (#78, #79)

This is a point-in-time evidence snapshot for the `0.3.0-alpha.1` release cycle, covering the
CodeQL/Scorecard code-scanning cleanup (#78) and release finalization (#79). It records what was
verified locally, what changed, and what is gated on GitHub-side automation or maintainer action.

## CodeQL findings (#78)

State pulled directly from `GET /repos/oaslananka/a2amesh/code-scanning/alerts` on 2026-07-03 (last
CodeQL run against `main`, before this branch existed):

| Alert | Rule                                          | Path                                                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #12   | `js/shell-command-injection-from-environment` | `packages/cli/src/commands/release-check.ts`           | Fixed in `d8f9a47`: `runCheck`'s `command` parameter is now the literal union `'node' \| 'pnpm' \| 'pnpm.cmd'` instead of `string`, and callers no longer pass `process.execPath` / `process.env.npm_execpath` (environment-controlled absolute paths) into the `cmd.exe /c` invocation.                                                                                                                                                                                                                                                 |
| #8    | `js/shell-command-injection-from-environment` | `packages/create-a2amesh/tests/create-a2amesh.test.ts` | Fixed in `d8f9a47`: same pattern — `execIn`'s `command` parameter is narrowed to `'node' \| 'pnpm.cmd'`, and the call site now passes the literal `'node'` instead of `process.execPath`.                                                                                                                                                                                                                                                                                                                                                |
| #9    | Scorecard `SAST` (score 7)                    | n/a                                                    | Organizational signal ("SAST tool detected but not run on all commits"). CodeQL now runs on every push/PR (`.github/workflows/codeql.yml`); the score improves as more commits land under that workflow. Not fixable by a single commit.                                                                                                                                                                                                                                                                                                 |
| #6    | Scorecard `CII-Best-Practices` (score 2)      | n/a                                                    | Requires enrolling in the OpenSSF/CII Best Practices badge program (external, maintainer/admin action). Not a code change.                                                                                                                                                                                                                                                                                                                                                                                                               |
| #5    | Scorecard `Code-Review` (score 0)             | n/a                                                    | Requires an actual history of approved changesets on protected `main`. Depends on branch protection + real reviewed merges over time — see issue #69 (independent maintainer recruitment) and `docs/governance/vulnerability-reporting-and-review-policy.md`.                                                                                                                                                                                                                                                                            |
| #4    | Scorecard `Maintained` (score 0)              | n/a                                                    | "Repository was created within the last 90 days." Resolves automatically as the repository ages past the 90-day window; not fixable by a commit.                                                                                                                                                                                                                                                                                                                                                                                         |
| #3    | Scorecard `Pinned-Dependencies` (score 8)     | `.github/workflows/security.yml`                       | Improved in `d8f9a47`: `pip install --user reuse==6.2.0` replaced with `pipx run --spec reuse==6.2.0 reuse lint`, removing the standalone unpinned install step. `pipx run --spec` still pins by version, not by hash — pip has no first-class hash-pinning UX for ad hoc tool runs the way `actions/*@<sha>` does for GitHub Actions. Full hash pinning would require vendoring a `requirements.txt` with `--hash` entries, which is out of scope for this pass; tracked as a follow-up if Scorecard continues to flag it after rescan. |
| #2    | Scorecard `Pinned-Dependencies` (score 8)     | `.github/workflows/publish.yml`                        | Fixed in `d8f9a47`: the `npm install -g "npm@${NPM_VERSION}"` step was removed entirely (replaced with `npm --version` reporting only), eliminating the unpinned global install.                                                                                                                                                                                                                                                                                                                                                         |

All `actions/*` steps in both workflows are already pinned to a full commit SHA (e.g.
`actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0`), so GitHub Actions supply-chain pinning
is already in place; the remaining Scorecard `Pinned-Dependencies` signal is specifically about the
non-Actions package installs addressed above.

**Verification performed locally:** read the diff for `d8f9a47` against the two flagged source files
and confirmed the taint source (`process.execPath` / `process.env.npm_execpath`, both
environment/runtime-derived absolute paths) is no longer reachable from the `cmd.exe /c` shell
invocation path. Searched the rest of `packages/**/src`, `packages/**/tests`, and `apps/**` for the
same `execPath`/`npm_execpath`/`cmd.exe` shape; no other CodeQL-flagged files show this pattern.
`scripts/*.mjs` build/CI helper scripts use similar `execFileSync`-based patterns for
Windows compatibility, but none were flagged by the last CodeQL run — they are out of scope for this
pass and should be revisited only if a future CodeQL run flags them specifically.

**Manual/GitHub-only follow-up:** CodeQL and Scorecard only run in GitHub Actions
(`.github/workflows/codeql.yml`, `.github/workflows/scorecard.yml`). The alert states above reflect
the last scan of `main`; they will not flip to "fixed" until this branch is pushed, a PR is opened,
and CodeQL/Scorecard re-run against the new commits. This cannot be verified or forced locally.

## Release finalization (#79)

- Package versions are managed by `release-please` (`release-please-config.json`,
  `.release-please-manifest.json`); all six public packages (`@a2amesh/protocol`, `@a2amesh/runtime`,
  `@a2amesh/registry`, `@a2amesh/mcp`, `@a2amesh/cli`, `@a2amesh/create-a2amesh`) are linked and
  currently at `0.2.0-alpha.1` on `main`.
- `release-please` derives the next version (expected `0.3.0-alpha.1` per the target issue) from
  Conventional Commits merged to `main` via the existing release PR (#76, `chore: release main`).
  Manually editing the manifest/version files would fight that automation and was intentionally
  **not** done here.
- Release config integrity was checked via `node scripts/check-release-config.mjs` and
  `node scripts/check-npm-pack.mjs` (see verification results in the PR description) — both pass
  against the current tree.
- Publishing itself (`npm publish --provenance`) is gated behind a manually-dispatched, approval-
  gated workflow (`.github/workflows/publish.yml`, `workflow_dispatch` with a typed
  `PUBLISH <tag>` confirmation). This was not triggered — publishing is out of scope for this pass
  per repository policy ("do not publish npm packages").

**Manual/maintainer follow-up required:**

1. Merge this branch's PR to `main` once CI is green.
2. Let `release-please` update PR #76 (or open a fresh release PR) to `0.3.0-alpha.1` based on the
   merged Conventional Commits.
3. Merge the release PR (version/changelog bump only — no publish).
4. Maintainer manually creates the release tag/GitHub Release and dispatches
   `.github/workflows/publish.yml` with the `PUBLISH <tag>` confirmation when ready to publish.
