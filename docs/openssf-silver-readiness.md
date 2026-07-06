# OpenSSF Silver readiness

This page summarizes the repository evidence used for OpenSSF Best Practices Silver self-certification. It does not replace the canonical project policies; it links to them.

## Passing prerequisite

The project has achieved the OpenSSF Best Practices Passing badge for project `13402`:

- <https://www.bestpractices.dev/en/projects/13402>

## Governance and contribution evidence

- Governance model: [GOVERNANCE.md](../GOVERNANCE.md)
- Maintainer roles and responsibilities: [MAINTAINERS.md](../MAINTAINERS.md)
- Code of conduct: [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- Contribution requirements and DCO sign-off policy: [CONTRIBUTING.md](../CONTRIBUTING.md)
- Coding standards: [docs/development/coding-standards.md](development/coding-standards.md)
- Testing policy: [docs/development/testing-policy.md](development/testing-policy.md)
- Roadmap: [ROADMAP.md](../ROADMAP.md) and [docs/fleet/roadmap.md](fleet/roadmap.md)

## Documentation evidence

- Architecture: [docs/development/architecture.md](development/architecture.md)
- Quickstart: [README.md](../README.md#quickstart), [docs/quickstart.md](quickstart.md), and [docs/fleet/quickstart.md](fleet/quickstart.md)
- Security requirements and threat model: [docs/security/threat-model.md](security/threat-model.md)
- Assurance case: [docs/security/assurance-case.md](security/assurance-case.md)
- API and external interfaces: [docs/protocol/api-surfaces.md](protocol/api-surfaces.md), [docs/openapi/registry.openapi.json](openapi/registry.openapi.json), and [docs/cli/index.md](cli/index.md)

## Build, test, and analysis evidence

- Build/test scripts: [package.json](../package.json)
- CI workflow: [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- CodeQL workflow: [.github/workflows/codeql.yml](../.github/workflows/codeql.yml)
- Security workflow: [.github/workflows/security.yml](../.github/workflows/security.yml)
- Dependency Review workflow: [.github/workflows/dependency-review.yml](../.github/workflows/dependency-review.yml)
- Scorecard workflow: [.github/workflows/scorecard.yml](../.github/workflows/scorecard.yml)

## Release and supply-chain evidence

- Release process: [docs/release/process.md](release/process.md)
- Package verification: [docs/release/package-verification.md](release/package-verification.md)
- Release integrity: [docs/security/release-integrity.md](security/release-integrity.md)
- Supply-chain security: [docs/security/supply-chain.md](security/supply-chain.md)
- SBOM/provenance evidence: [docs/security/sbom-provenance-evidence-2026-07-03.md](security/sbom-provenance-evidence-2026-07-03.md)

## Known Silver blockers

The following items should not be overstated:

1. **Access continuity / bus factor**: currently tracked by [#125](https://github.com/oaslananka/a2amesh/issues/125). Silver continuity should be marked complete only after an independent maintainer or equivalent recovery mechanism is in place.
2. **Signed releases / signed tags**: release documentation exists, but official release signing/provenance evidence should be attached after the Release Please and npm publish flow completes.
3. **Private vulnerability reporting confirmation**: verified enabled and closed as [#70](https://github.com/oaslananka/a2amesh/issues/70), documented in [SECURITY.md](../SECURITY.md) and [governance policy](governance/vulnerability-reporting-and-review-policy.md).
