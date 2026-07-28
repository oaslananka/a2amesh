# OpenSSF evidence

This page records dated evidence for OpenSSF Best Practices and Scorecard review. It is not a
Silver, Gold, foundation-grade, or production-maturity claim.

## Project status

- Repository: `https://github.com/oaslananka/a2amesh`
- OpenSSF Best Practices project: `13402`
- Current OpenSSF Best Practices **Passing badge**, achieved **2026-07-03**
- Review owner: `@oaslananka`
- Last reviewed: **2026-07-28**
- Language/runtime: TypeScript / Node.js / pnpm workspace
- Package manager: `pnpm@11.8.0`
- Target maturity: Professional OSS / Mature OSS
- Gold claim: No

## Evidence matrix

| Area                         | Status  | Evidence                                                                                                              |
| ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Source repository            | Passed  | Public GitHub repository with protected `main`.                                                                       |
| License                      | Passed  | GitHub reports Apache-2.0; package metadata and REUSE checks agree.                                                   |
| Build system                 | Passed  | `pnpm run build`.                                                                                                     |
| Tests                        | Passed  | Unit, integration, recovery, conformance, coverage, UI, smoke, fuzz/property, and mutation checks.                    |
| CI                           | Passed  | `.github/workflows/ci.yml`; fail-closed `CI / tests-required` and `CI / required-summary`.                            |
| Security policy              | Passed  | `SECURITY.md`; private vulnerability reporting verified enabled on 2026-07-28.                                        |
| Dependency and SAST controls | Passed  | Dependency Review, audit, OSV, CodeQL, Semgrep, and Scorecard workflows.                                              |
| Secret controls              | Passed  | GitHub secret scanning and push protection enabled; Gitleaks required.                                                |
| Release integrity            | Passed  | `0.14.0-alpha.1` has six npm packages, checksums, CycloneDX SBOM, npm SLSA provenance, and GitHub asset attestations. |
| Human review                 | Partial | Solo-maintainer model; independent recurring review is not yet available.                                             |
| Governance                   | Partial | Governance and continuity policies exist; multi-maintainer evidence is not yet available.                             |

## Current Scorecard observation

The public Scorecard API reported **7.1** on **2026-07-28T00:27:40Z** using Scorecard `v5.3.0`.
The complete gap ownership and disposition table is maintained in
[`docs/security/scorecard.md`](security/scorecard.md). Detector results that conflict with live
GitHub settings or published attestations are recorded as detector limitations, not silently
presented as missing controls.

## Published release evidence

The latest verified release is `@a2amesh/runtime-v0.14.0-alpha.1`:

- six npm packages are visible on the `alpha` dist-tag;
- all six release tarballs pass `sha256sum -c SHA256SUMS`;
- the release contains `SHA256SUMS` and a CycloneDX 1.6 SBOM with six public components;
- every npm package exposes registry signatures and SLSA provenance tied to
  `.github/workflows/publish.yml`, `refs/heads/main`, and source commit `08ca84a16b87`;
- GitHub's attestation API binds the release asset digests to the publish workflow evidence.

Reproduction commands and the dated verification record are in
[`docs/security/sbom-provenance-evidence-2026-07-03.md`](security/sbom-provenance-evidence-2026-07-03.md)
and [`docs/release/package-verification.md`](release/package-verification.md).

## Human or time-dependent limitations

- Silver continuity and independent-review criteria remain incomplete until another active
  maintainer or equivalent independently exercised recovery authority exists.
- Scorecard `Maintained` must be re-evaluated after **2026-09-26**, when the repository is older
  than 90 days.
- Third-party NOTICE material should be added only when a verified license obligation requires it.
- Each future release needs its own registry, checksum, SBOM, provenance, and attestation review.

## Credential scope evidence

- `docs/security/github-actions-access-inventory.json` records the remaining GitHub Actions secret,
  its owner, consumer, purpose, rotation path, and the protected `npm-publish` environment.
- `scripts/check-security-tooling.mjs` rejects undocumented workflow secret references, broad
  write-all permissions, static npm credentials, and stale credential evidence.
