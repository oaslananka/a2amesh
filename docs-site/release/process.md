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
6. Owner dispatches `publish.yml` with the release tag and the exact prerelease
   `PUBLISH <tag>` confirmation, or `PUBLISH STABLE <tag>` for a reviewed stable tag.
7. Publish workflow validates release state, runs publish preflight, checks that
   package sources match the tag, packs packages, smoke-installs tarballs,
   writes SHA-256 checksums, emits the CycloneDX SBOM, creates artifact
   attestations, publishes to npm through Trusted Publishing/OIDC, and verifies
   registry visibility.

The canonical publish tag format is:

```text
@a2amesh/runtime-v<semver>
```

## npm channel contract and stable promotion

Prerelease publication never advances `latest`. A prerelease version derives its npm dist-tag from
the first SemVer prerelease identifier (`alpha`, `beta`, or `rc`), and every linked public package
must expose that tag at the exact release version. Keep user-facing prerelease install commands on
the intended channel such as `@alpha`, or pin the exact published version for repeatable automation.

A stable version without a prerelease identifier is the only publish path that derives `latest`.
Stable promotion is a separate maintainer decision: verify `pnpm run release:stable-ready`, record the
current dist-tags for every linked public package, and dispatch `publish.yml` with the exact
`PUBLISH STABLE <tag>` confirmation. The ordinary `PUBLISH <tag>` confirmation remains the
prerelease path and cannot authorize a stable tag.

When a maintainer deliberately selects an exact next release version, use the one-shot top-level
`release-as` setting in `release-please-config.json` rather than hand-editing generated package
versions. The Release Please post-processing step derives each tracked `public-surface.json` status and
user-facing package-install selector from the generated SemVer channel, stages the active release PR
version in repository evidence while preserving the last published release facts, then removes
`release-as` in the release pull request. Merging that release therefore returns `main` to normal
Conventional Commit version calculation without leaving prerelease install commands or stale release
candidate evidence behind after stable promotion.

After any publish or approved dist-tag repair, run all three checks before announcing the channel:

```bash
pnpm run release:tags:check
pnpm run release:parity
pnpm run release:state
```

PowerShell:

```powershell
pnpm run release:tags:check
pnpm run release:parity
pnpm run release:state
```

## Dist-tag recovery

If publication is partial or a dist-tag drifts, stop further promotion and inspect the registry before
changing anything. npm versions are immutable; do not republish an existing version to repair tag
state. Record `npm view <package> dist-tags --json` for every public package and preserve the
previous `latest` value before any stable promotion.

For a prerelease whose intended channel is stale or missing, use `pnpm run release:tags:check` first
and then the reviewed `pnpm run release:tags:sync` repair path. That synchronizer updates the
intended prerelease tag only; it must not be used to advance `latest`.

If an authorized release operation changed `latest` incorrectly, restore the exact value recorded
before that operation. With an authenticated npm maintainer session, repeat this for every linked
public package and then rerun the checks above:

```bash
previous_latest=0.0.0
for package in \
  @a2amesh/protocol \
  @a2amesh/runtime \
  @a2amesh/registry \
  @a2amesh/mcp \
  @a2amesh/cli \
  @a2amesh/create-a2amesh
 do
  npm dist-tag add "$package@$previous_latest" latest
 done
```

PowerShell:

```powershell
$previousLatest = '0.0.0'
$packages = @(
  '@a2amesh/protocol',
  '@a2amesh/runtime',
  '@a2amesh/registry',
  '@a2amesh/mcp',
  '@a2amesh/cli',
  '@a2amesh/create-a2amesh'
)
foreach ($package in $packages) {
  npm dist-tag add "$package@$previousLatest" latest
}
```

Replace the placeholder with the previously observed `latest` version; never infer a rollback target
from the failed release. If there was no prior `latest`, remove the accidental tag explicitly with
`npm dist-tag rm <package> latest` instead of inventing one. Keep the before/after dist-tag output,
release workflow URL, and parity/state results with the release evidence.

Do not create tags, GitHub Releases, npm publishes, or container pushes during
rebuild work without owner instruction. A prerelease that passes this flow is not automatically
a stable candidate; use the [Stable Release Criteria](./stable-release-criteria.md) and its
fail-closed `release:stable-ready` gate on the exact generated stable candidate before merging it or
creating the canonical stable tag.

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

1. Confirms prereleases with `PUBLISH <tag>` and stable tags only with `PUBLISH STABLE <tag>`.
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
