# Release Integrity State Machine

A2A Mesh separates source-version preparation from protected npm publication.
The release-state guard prevents those two phases from drifting silently across
package manifests, Git tags, npm versions, and npm dist-tags.

## Authority and policy

The linked versions in `.release-please-manifest.json` and the six public
package manifests define the prepared source version for a checked-out commit.
Publication additionally requires:

- canonical tag `@a2amesh/runtime-v<version>` on that exact commit;
- the same version for every configured public package on npm;
- `latest` for stable releases, or the first prerelease identifier such as
  `alpha`, `beta`, or `rc` for prereleases;
- `latest` not pointing to the prepared prerelease.

Release Please prepares source versions and changelogs. It does not create the
canonical tag, GitHub Release, or npm publication. Those remain explicit
maintainer operations protected by the `npm-publish` environment.

## States and gates

| State                  | Meaning                                                       | Release Please | Publish                                               |
| ---------------------- | ------------------------------------------------------------- | -------------- | ----------------------------------------------------- |
| `published`            | Tag, all npm versions, and required dist-tags agree.          | Allow          | Block                                                 |
| `release-pr-open`      | Current version is published; one newer linked PR is open.    | Allow          | Block                                                 |
| `prepared-unpublished` | Source agrees, but tag or npm publication is absent.          | Block          | Allow only after the exact tag exists                 |
| `partial-publication`  | Only part of the linked npm release is visible.               | Block          | Allow only when missing packages are safely resumable |
| `drifted`              | Source, tag commit, release PR, or dist-tag policy conflicts. | Block          | Block                                                 |
| `unavailable`          | GitHub or npm could not be observed reliably.                 | Block          | Block                                                 |

An open Release Please PR for a newer version is informational during
publication of the already prepared version. It does not, by itself, block the
protected Publish workflow.

## Local commands

Use Corepack so the repository-pinned pnpm version is used even when a local
version-manager shim is misconfigured:

```bash
corepack pnpm run release:state
corepack pnpm run release:state:release-please
corepack pnpm run release:state:publish -- --tag '@a2amesh/runtime-v0.11.0-alpha.1'
```

`release:state` prints a human-readable summary. Gate commands emit deterministic
JSON and return a nonzero status when the requested operation is unsafe.
Authenticate GitHub CLI before running the collector outside Actions:

```bash
gh auth status
```

## Normal release flow

1. Release Please opens or updates one linked-version pull request.
2. Review and merge that release pull request.
3. The main-branch Release Please workflow observes `prepared-unpublished` and
   stops before creating the next release pull request.
4. Identify the exact release commit containing the reviewed version and
   changelogs.
5. Create and push the canonical runtime tag on that commit.
6. Dispatch the Publish workflow from the current `main` workflow definition,
   passing the canonical tag as input.
7. Publish builds the tagged source, publishes missing packages idempotently,
   and verifies npm visibility and registry parity.
8. After state becomes `published`, later qualifying changes may prepare the next
   linked version.

The workflow is dispatched from `main`, not from an old release tag. The current
workflow stages its release-state guard modules before checking out the target
tag, so historical release commits can still be validated with the current
policy.

## Tag and publish commands

Review the candidate commit before creating a tag:

```bash
release_commit='<verified-release-commit>'
release_tag='@a2amesh/runtime-v0.11.0-alpha.1'

git show --stat "$release_commit"
git show "$release_commit:.release-please-manifest.json"
git tag -a "$release_tag" "$release_commit" -m "Release 0.11.0-alpha.1"
git push origin "$release_tag"
```

Then dispatch the protected workflow from `main`:

```bash
gh workflow run Publish \
  --ref main \
  -f tag='@a2amesh/runtime-v0.11.0-alpha.1' \
  -f confirmation='PUBLISH @a2amesh/runtime-v0.11.0-alpha.1'
```

Tag creation and workflow dispatch are maintainer actions. The state collector
never creates tags, publishes packages, or changes npm dist-tags.

## Partial-publication recovery

The publish loop skips package versions that already exist and may resume when
only some linked packages were published, provided every existing package is the
same prepared version and already has the expected dist-tag. It blocks when:

- the canonical tag resolves to another commit;
- existing packages represent conflicting versions;
- all versions exist but required dist-tags are inconsistent;
- a prerelease has incorrectly advanced `latest`;
- GitHub or npm observations are unavailable.

Do not delete or overwrite an npm version. Reconcile the incident, preserve
registry evidence, and rerun Publish only when `gates.publish` is `true`.

## 0.11.0-alpha.1 recovery evidence

The linked `0.11.0-alpha.1` source version was introduced by:

```text
a10452970f9db426f9ef6a407f8be2d69d10eec8 chore: release main (#138)
```

The July 20, 2026 live audit found:

- canonical tag `@a2amesh/runtime-v0.11.0-alpha.1` absent;
- all six `0.11.0-alpha.1` npm package versions absent;
- `alpha` still pointing to `0.5.0-alpha.1`;
- `latest` remaining on older prerelease versions;
- PR #156 preparing the linked `0.12.0-alpha.1` version.

A temporary local tag on commit `a104529…` produced
`prepared-unpublished` with `gates.publish: true`. The temporary tag was deleted
and was never pushed.

Safe recovery order:

1. Merge the release-integrity guard change.
2. Create the `0.11.0-alpha.1` canonical tag on `a104529…`.
3. Dispatch Publish from `main` and verify all six packages plus `alpha`.
4. Merge or refresh PR #156 so source advances to `0.12.0-alpha.1`.
5. Keep the next Release Please preparation blocked until `0.12.0-alpha.1` is
   intentionally tagged and published or explicitly superseded.

Do not tag the current main commit as `0.11.0-alpha.1`; later package changes
would then be published under a changelog and version prepared by the historical
release commit.
