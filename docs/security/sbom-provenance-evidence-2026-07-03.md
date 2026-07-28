# SBOM and Provenance Verification Evidence — 2026-07-03 to 2026-07-28

This page preserves the original 2026-07-03 local pre-publish verification and adds the
published-release verification completed on 2026-07-28. Evidence is recorded only from public
GitHub release, npm registry, Sigstore, and workflow output; no provenance is fabricated.

## What was run

```bash
pnpm run release:artifacts   # scripts/prepare-release-artifacts.mjs
pnpm run release:validate    # scripts/validate-release-config.mjs
```

## SBOM evidence

`release:artifacts` generated a real CycloneDX SBOM at `.artifacts/sbom/a2amesh.cdx.json`:

- `bomFormat: CycloneDX`, `specVersion: 1.6`.
- 6 components, one per linked public package at the current manifest version
  (`0.2.0-alpha.1`): `@a2amesh/cli`, `@a2amesh/create-a2amesh`, `@a2amesh/mcp`,
  `@a2amesh/protocol`, `@a2amesh/registry`, `@a2amesh/runtime` — matching exactly the
  `linked-versions` group in `release-please-config.json`. No internal-only (`private: true`)
  packages leaked into the SBOM component list.
- Each component has a `purl` in the correct `pkg:npm/%40a2amesh/<name>@<version>` form.

## Checksum evidence

`release:artifacts` also produced npm pack tarballs and `SHA256SUMS` under `.artifacts/npm/`.
Verified locally with `sha256sum -c SHA256SUMS`:

```text
a2amesh-cli-0.2.0-alpha.1.tgz: OK
a2amesh-create-a2amesh-0.2.0-alpha.1.tgz: OK
a2amesh-mcp-0.2.0-alpha.1.tgz: OK
a2amesh-protocol-0.2.0-alpha.1.tgz: OK
a2amesh-registry-0.2.0-alpha.1.tgz: OK
a2amesh-runtime-0.2.0-alpha.1.tgz: OK
```

All six tarballs verify against their recorded SHA-256 digests.

## Release config validation

`release:validate` reported: `release-please manifest configuration validated locally.` — the
manifest, linked-versions group, and per-package configuration are internally consistent.

## Published release verification — 2026-07-28

The prerelease `@a2amesh/runtime-v0.14.0-alpha.1` was verified as an external consumer against
public release and registry data.

| Evidence                      | Verified result                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source release                | `A2A Mesh 0.14.0-alpha.1`, published 2026-07-27; canonical tag points to `08ca84a16b87306b6f51ada9b6ea61bf35d20c7c`.                                                      |
| npm publish run               | GitHub Actions run `30231021914`; SLSA statements resolve to `.github/workflows/publish.yml`, `refs/heads/main`, GitHub-hosted builder, and source commit `08ca84a16b87`. |
| Release asset attestation run | GitHub Actions run `30234144129`; GitHub's attestation API binds all release asset SHA-256 subjects to `.github/workflows/publish.yml`.                                   |
| npm packages                  | All six published npm packages resolve at `0.14.0-alpha.1` on the `alpha` dist-tag and point to the correct repository subdirectory.                                      |
| Registry signatures           | Every package exposes an npm registry signature and two Sigstore attestations, including SLSA provenance v1.                                                              |
| GitHub Release assets         | Eight assets: six npm tarballs, `SHA256SUMS`, and `a2amesh.cdx.json`.                                                                                                     |
| Checksums                     | `sha256sum -c SHA256SUMS` returned `OK` for all six tarballs.                                                                                                             |
| SBOM                          | CycloneDX 1.6 with six public package components.                                                                                                                         |

The checksum verification command was:

```bash
gh release download '@a2amesh/runtime-v0.14.0-alpha.1' \
  --repo oaslananka/a2amesh \
  --dir /tmp/a2amesh-release-verify
(cd /tmp/a2amesh-release-verify && sha256sum -c SHA256SUMS)
```

Registry provenance was independently read from each package's public npm attestation endpoint.
For example, the runtime statement identifies:

- subject `pkg:npm/%40a2amesh/runtime@0.14.0-alpha.1`;
- predicate type `https://slsa.dev/provenance/v1`;
- builder `https://github.com/actions/runner/github-hosted`;
- workflow `.github/workflows/publish.yml` in `oaslananka/a2amesh`;
- ref `refs/heads/main`;
- invocation run `30231021914`;
- resolved source commit `08ca84a16b87306b6f51ada9b6ea61bf35d20c7c`.

The same workflow/ref/repository relationship was verified for the other five published npm
packages. The GitHub attestation API returned SLSA provenance covering the release asset digest
set. A local `gh` client without the newer `gh attestation` subcommand can reproduce the check
through the REST attestation endpoint; upgrading the CLI is optional and is not a release
requirement.

OpenSSF Scorecard still reported `Signed-Releases` as 0 on 2026-07-28. That detector result is kept
as a documented coverage/lag discrepancy because the public npm and GitHub attestations above are
independently verifiable. Existing provenance controls must not be weakened or duplicated merely to
change the detector score.

## Historical pre-publish limitation (superseded on 2026-07-28)

The following records the original 2026-07-03 state and no longer describes the current release.

npm provenance (`npm view "$PACKAGE@$VERSION" provenance --json`, per
[Package Verification](../release/package-verification.md#verify-provenance)) is only produced by
running `npm publish --provenance` inside `.github/workflows/publish.yml` under npm Trusted
Publishing / GitHub OIDC. It cryptographically attests to the exact GitHub Actions run, commit, and
workflow that produced the published tarball — it cannot be computed offline or predicted ahead of
an actual publish. This repository's policy is "do not publish npm packages" during this pass, so no
provenance statement exists yet for `0.2.0-alpha.1` or the upcoming `0.3.0-alpha.1`.

Separately, `publish.yml` also runs `actions/attest-build-provenance` to create a GitHub Artifact
Attestation for each tarball (verifiable with `gh attestation verify <tarball> --owner oaslananka`,
see [Package Verification](../release/package-verification.md#verify-the-github-build-attestation)).
Like npm provenance, this attestation only exists once `publish.yml` actually runs — it is a Sigstore
transparency-log entry tied to a real workflow run, not something that can be produced or predicted
offline.

**Historical follow-up recorded on 2026-07-03:**

1. Merge to `main`, let `release-please` cut the `0.3.0-alpha.1` release PR, merge it (version bump
   only).
2. A maintainer creates the release tag/GitHub Release and manually dispatches
   `.github/workflows/publish.yml` with the required `PUBLISH <tag>` confirmation.
3. After publish, follow [Package Verification](../release/package-verification.md) in full: confirm
   npm registry visibility, dist-tags, tarball checksums against the published tarballs (not just the
   local pack), and `npm view ... provenance --json` resolving to `oaslananka/a2amesh`, workflow
   `publish.yml`, environment `npm-publish`.
4. Attach the SBOM (`.artifacts/sbom/a2amesh.cdx.json` regenerated at release time) and this
   checklist's checksum output to the GitHub Release.
