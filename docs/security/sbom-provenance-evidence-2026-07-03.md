# SBOM and Provenance Verification Evidence — 2026-07-03 (#72)

This records real, locally-reproduced evidence for the SBOM and provenance path documented in
[Package Verification](../release/package-verification.md), run against this branch's tree before
any publish. Nothing here was published to npm and no provenance was fabricated — provenance
attestation itself can only be produced during an actual `npm publish --provenance` run in
`.github/workflows/publish.yml` under GitHub OIDC (see "Blocked on publish" below).

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

## Blocked on publish (cannot be produced or faked locally)

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

**Manual/CI follow-up required for a real release:**

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
