# OpenSSF Silver readiness

This page summarizes repository evidence relevant to a future OpenSSF Best Practices Silver
self-certification. It does not claim Silver.

## Passing prerequisite

The project achieved the OpenSSF Best Practices **Passing** badge for project `13402` on
**2026-07-03**:

- <https://www.bestpractices.dev/en/projects/13402>

## Governance and contribution evidence

- Governance model: [GOVERNANCE.md](../GOVERNANCE.md)
- Maintainer roles and responsibilities: [MAINTAINERS.md](../MAINTAINERS.md)
- Code of conduct: [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- Contribution requirements and DCO policy: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Coding standards: [docs/development/coding-standards.md](development/coding-standards.md)
- Testing policy: [docs/development/testing-policy.md](development/testing-policy.md)
- Roadmap: [ROADMAP.md](../ROADMAP.md) and [docs/fleet/roadmap.md](fleet/roadmap.md)

## Build, analysis, and release evidence

- CI: [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- CodeQL: [.github/workflows/codeql.yml](../.github/workflows/codeql.yml)
- Security checks: [.github/workflows/security.yml](../.github/workflows/security.yml)
- Dependency Review: [.github/workflows/dependency-review.yml](../.github/workflows/dependency-review.yml)
- Scorecard: [.github/workflows/scorecard.yml](../.github/workflows/scorecard.yml)
- Release process: [docs/release/process.md](release/process.md)
- Package verification: [docs/release/package-verification.md](release/package-verification.md)
- Published evidence: [docs/security/sbom-provenance-evidence-2026-07-03.md](security/sbom-provenance-evidence-2026-07-03.md)

The `0.14.0-alpha.1` release has six npm packages with registry signatures and SLSA provenance,
six checksum-verified release tarballs, `SHA256SUMS`, a CycloneDX 1.6 SBOM, and GitHub release
asset attestations.

## Remaining Silver blockers

1. **Access continuity and independent review:** the repository remains solo-maintained. Silver
   continuity or review criteria must remain incomplete until another active maintainer, or an
   equivalently independent and exercised recovery authority, exists.
2. **Recurring evidence:** one verified release does not prove sustained release discipline. Repeat
   registry, checksum, SBOM, provenance, and attestation verification for future releases.
3. **Criteria-specific human confirmation:** complete only those Silver BadgeApp answers that can be
   supported by current public policy, repository settings, and independently reproducible output.

Private vulnerability reporting was re-verified enabled through the GitHub API on 2026-07-28.
Gold or foundation-grade maturity is not claimed.
