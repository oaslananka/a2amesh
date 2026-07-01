# Package Verification

Use this guide after every A2A Mesh release or prerelease to verify that the npm packages, Git tag, generated artifacts, checksums, SBOM, and provenance all describe the same reviewed source revision.

## Trust boundaries

A valid release must satisfy all of these checks:

1. The GitHub Release tag uses the canonical format `@a2amesh/runtime-v<semver>`.
2. The tag points at the reviewed commit that produced the release artifacts.
3. The published npm packages are public packages under the `@a2amesh` scope.
4. Package versions, tarball names, dist-tags, checksums, and SBOM entries match the intended release version.
5. npm provenance is present and points back to `oaslananka/a2amesh`, workflow `publish.yml`, and environment `npm-publish`.
6. The local verification scripts pass against the checked-out tag or commit.

Do not republish an existing version to repair a failed verification. npm versions are immutable. Fix the source of the mismatch, create a new reviewed release, and publish a new version.

## Verify the source tag

Fetch tags and inspect the release tag before checking package artifacts:

```bash
git fetch --tags origin
TAG=@a2amesh/runtime-v0.2.0-alpha.1
git tag --verify "$TAG" || git tag --list "$TAG"
git show --stat --decorate --no-renames "$TAG"
gh release view "$TAG" --repo oaslananka/a2amesh
```

The tag and GitHub Release must identify the same commit that Release Please updated and maintainers reviewed. If the release is a prerelease, the GitHub Release must be marked as prerelease and npm packages must use the matching prerelease dist-tag.

## Build and validate local artifacts

From a clean checkout of the tag or the release candidate commit:

```bash
pnpm install --frozen-lockfile
pnpm run release:state
pnpm run release:preflight -- --tag "$TAG"
pnpm run release:artifacts
pnpm run release:validate
```

`release:artifacts` creates local npm tarballs, checksum files, and SBOM material under `.artifacts/`. `release:validate` verifies that generated artifacts are internally consistent before publication or after a release candidate rebuild.

## Verify npm package visibility and dist-tags

Check every public package in the linked-version release set:

```bash
VERSION=0.2.0-alpha.1
for package in \
  @a2amesh/protocol \
  @a2amesh/runtime \
  @a2amesh/registry \
  @a2amesh/mcp \
  @a2amesh/cli \
  @a2amesh/create-a2amesh
 do
  npm view "$package@$VERSION" version dist-tags repository --json
 done
```

For prereleases, the expected prerelease channel, such as `alpha`, must point to the release version. The `latest` tag may also point at the first alpha package if there is no stable release yet; once stable releases exist, do not move `latest` to prerelease builds.

The repository metadata for every package must point to `oaslananka/a2amesh`. If a package is missing, private, or assigned to the wrong dist-tag, stop and investigate the publish workflow logs before any follow-up release action.

## Verify tarballs and checksums

Download the published tarball metadata and compare it with the release artifacts:

```bash
PACKAGE=@a2amesh/runtime
VERSION=0.2.0-alpha.1
npm view "$PACKAGE@$VERSION" dist.tarball dist.integrity dist.shasum --json
npm pack "$PACKAGE@$VERSION" --pack-destination /tmp/a2amesh-verify
sha256sum /tmp/a2amesh-verify/*.tgz
```

Compare the SHA-256 output with the checksum artifact created by `publish.yml` and by local `pnpm run release:artifacts`. The npm `dist.integrity` field is the registry Subresource Integrity value; keep it with the verification record because it independently identifies the published tarball content.

## Verify provenance

A2A Mesh publishes through npm Trusted Publishing and GitHub OIDC. For every public package, confirm that npm provenance is present:

```bash
npm view "$PACKAGE@$VERSION" provenance --json
npm audit signatures --package-lock-only
```

The provenance statement must resolve to:

- GitHub repository: `oaslananka/a2amesh`
- Workflow file: `publish.yml`
- Environment: `npm-publish`
- Ref/tag: the canonical release tag

If npm provenance is absent, the release is not acceptable for the supported supply-chain path. Do not add token-based fallback publishing. Fix Trusted Publishing configuration and publish a new version.

## Verify the SBOM

The publish workflow emits a CycloneDX SBOM for the release artifact set. Validate it before attaching or consuming it:

```bash
pnpm run release:artifacts
find .artifacts -iname '*sbom*' -o -iname '*.cdx.json'
```

The SBOM must include all public packages in the release set and must not include internal-only packages as published npm components. Store the SBOM with the GitHub Release artifacts so downstream consumers can map package versions back to source, dependencies, and checksums.

## Verify prerelease channels

Prerelease packages use semver prerelease identifiers and matching npm dist-tags:

| Version example | Expected npm dist-tag | Notes                                     |
| --------------- | --------------------- | ----------------------------------------- |
| `0.2.0-alpha.1` | `alpha`               | Early external validation channel.        |
| `0.2.0-beta.1`  | `beta`                | Feature-complete release candidate track. |
| `1.0.0-rc.1`    | `rc`                  | Final release-candidate validation track. |
| `1.0.0`         | `latest`              | Stable release channel.                   |

Use `pnpm run release:parity` after publishing. It checks npm registry visibility and confirms that published package versions are aligned. Registry propagation can lag; rerun parity after propagation rather than republishing immutable versions.

## Evidence to keep

For each release, keep these verification records with the GitHub Release or the release issue:

- Git tag and commit SHA.
- Release workflow run URL.
- `release:state`, `release:preflight`, `release:validate`, and `release:parity` output.
- npm package version and dist-tag output for every public package.
- Tarball SHA-256 checksums and npm `dist.integrity` values.
- SBOM artifact name and checksum.
- npm provenance summary for every public package.

This evidence is also the input for the project trust and bestpractice.dev documentation work.
