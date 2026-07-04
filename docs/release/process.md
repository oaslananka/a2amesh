# Release Process

A2A Mesh separates version planning, GitHub Release creation, artifact generation,
and npm publication. Ordinary CI never publishes packages.

## Release path

1. Merge ordinary changes through pull requests.
2. Let Release Please propose version and changelog updates.
3. Verify the release candidate locally.
4. Merge the reviewed Release Please pull request.
5. Maintainer creates the git tag and GitHub Release manually for the reviewed
   commit because `release-please.yml` sets `skip-github-release: true`.
6. Owner dispatches `publish.yml` with the release tag and the exact
   `PUBLISH <tag>` confirmation input.
7. Publish workflow validates release state, runs publish preflight, checks that
   package sources match the tag, packs packages, smoke-installs tarballs,
   writes SHA-256 checksums, emits the CycloneDX SBOM, creates artifact
   attestations, publishes to npm through Trusted Publishing/OIDC, and verifies
   registry visibility.

The canonical publish tag format is:

```text
@a2amesh/runtime-v<semver>
```

Do not create tags, GitHub Releases, npm publishes, or container pushes during
rebuild work without owner instruction.

## Local maintainer validation

Run these checks before dispatching `publish.yml`:

Linux/macOS:

```bash
pnpm run verify
pnpm run release:state
pnpm run release:preflight -- --tag @a2amesh/runtime-v0.1.0-alpha.0
pnpm run release:dry-run
pnpm run release:artifacts
pnpm run release:validate
```

PowerShell:

```powershell
pnpm run verify
pnpm run release:state
pnpm run release:preflight -- --tag @a2amesh/runtime-v0.1.0-alpha.0
pnpm run release:dry-run
pnpm run release:artifacts
pnpm run release:validate
```

`release:state` reports open Release Please pull requests, draft releases,
manifest coverage, and whether the current repository is the canonical release
repository. `release:preflight` validates package names, tag format, runtime and
package-manager metadata, package `publishConfig`, release-please linked-version
coverage, and publish workflow OIDC/provenance guardrails.

## npm Trusted Publisher matrix

Each npm package must be configured in npm Trusted Publishing with this GitHub
publisher identity:

- Repository: `oaslananka/a2amesh` (GitHub owner/repo)
- Workflow: `publish.yml`
- Environment: `npm-publish`

| Package                   | Path                      | Release mode                  | npm Trusted Publisher                                |
| ------------------------- | ------------------------- | ----------------------------- | ---------------------------------------------------- |
| `@a2amesh/protocol`       | `packages/protocol`       | Release Please linked version | `oaslananka/a2amesh` / `publish.yml` / `npm-publish` |
| `@a2amesh/runtime`        | `packages/runtime`        | Release Please linked version | `oaslananka/a2amesh` / `publish.yml` / `npm-publish` |
| `@a2amesh/registry`       | `packages/registry`       | Release Please linked version | `oaslananka/a2amesh` / `publish.yml` / `npm-publish` |
| `@a2amesh/mcp`            | `packages/mcp`            | Release Please linked version | `oaslananka/a2amesh` / `publish.yml` / `npm-publish` |
| `@a2amesh/cli`            | `packages/cli`            | Release Please linked version | `oaslananka/a2amesh` / `publish.yml` / `npm-publish` |
| `@a2amesh/create-a2amesh` | `packages/create-a2amesh` | Release Please linked version | `oaslananka/a2amesh` / `publish.yml` / `npm-publish` |

Internal/private packages (`@a2amesh/internal-*`) are **not** published to npm
during the first alpha. They are not part of the Trusted Publisher configuration.

The preflight script can verify repository files and workflow guardrails, but it
cannot read npm package Trusted Publisher settings without npm registry
permissions. Maintainers must confirm the npm package settings match this matrix
before the first publish or after any package rename.

## Scoped package permissions

All packages under `@a2amesh/*` must be public packages in npm. Their
package manifests keep `publishConfig.access: public`, and the publish workflow
uses `npm publish --access public --provenance` so first publish and republish
use the same command path.

Do not add long-lived npm registry token secrets, fallback token publishing, or
dist-tag mutation steps to the publish workflow.

## Manual GitHub Release creation

Release Please updates versions and changelogs only. Because `skip-github-release`
is enabled, a maintainer creates the GitHub Release manually after the Release
Please pull request is merged and before npm publication.

The manual GitHub Release must point to the same commit that `publish.yml` will
publish. Use the canonical tag format `@a2amesh/runtime-v<semver>` for the
release that triggers npm publishing. If component-specific tags exist, do not
use them to dispatch `publish.yml` unless the workflow has been explicitly
updated to accept that component tag.

## Publish workflow verification

`publish.yml` performs these guardrails before it can publish:

1. Confirms the input must exactly equal `PUBLISH <tag>`.
2. Validates the tag format and extracts the version.
3. Runs `node scripts/release-state.mjs --check` to block stale release state,
   open Release Please pull requests, draft releases, or non-canonical repos.
4. Runs `node scripts/check-publish-preflight.mjs` to verify package metadata,
   release-please config, runtime requirements, and Trusted Publishing
   workflow requirements.
5. Confirms source files for packages, lockfile, and release config match the
   requested tag.
6. Builds, typechecks, tests, packs, validates artifacts, attests checksums and
   SBOM, publishes with `--provenance`, and checks npm registry visibility.

## Package verification

After a release or prerelease is published, follow the package verification guide to verify npm visibility, dist-tags, tarball checksums, SBOM output, and npm provenance before announcing the release.

- Source docs: [Package Verification](./package-verification.md)

## Registry verification

After publish, confirm npm shows the expected package versions and provenance.
The workflow runs `pnpm run release:parity` after registry propagation. If npm
has not propagated yet, rerun parity after the registry becomes consistent
instead of republishing existing tarballs.

## Local release state checks

`pnpm run release:state` calls the GitHub CLI to inspect open Release Please pull requests and release state. When running it outside GitHub Actions, authenticate first with `gh auth login` or configure an equivalent GitHub CLI token in the shell environment. Without that authentication, the command fails before it can read repository release state.
