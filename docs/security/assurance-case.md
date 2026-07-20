# Assurance case

## Claim

A2A Mesh aims to provide a professional OSS baseline for A2A runtime, registry, CLI, protocol, and MCP integration work.

## Evidence

- CI validates build, lint, typecheck, tests, conformance, package dry-runs, and gc checks.
- Security workflow covers audit, gitleaks, OSV, dependency/license checks, REUSE, actionlint, and zizmor.
- CodeQL provides SAST coverage.
- Branch protection blocks direct unverified changes to `main`.
- Documentation defines contribution, support, security, testing, release, and governance expectations.

## Assumptions

- Maintainer GitHub and registry accounts are protected with strong authentication.
- Release secrets are configured outside the repository.
- GitHub security settings remain enabled.
- Dependencies are reviewed before adoption.

## Open risks

- Solo-maintainer bus factor.
- No independent human review requirement yet.
- GitHub license metadata refresh is pending after restoring the canonical Apache-2.0 corpus.
- Release provenance and SBOM publication need ongoing verification.
