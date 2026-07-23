# OpenSSF evidence

This file records evidence for OpenSSF Best Practices and Scorecard-oriented review. It is not a badge claim by itself.

## Project metadata

- Repository: `https://github.com/oaslananka/a2amesh`
- Language/runtime: TypeScript / Node.js / pnpm workspace
- Package manager: `pnpm@11.8.0`
- Target maturity: Professional OSS / Mature OSS
- Gold claim: No

## Evidence matrix

| Area                | Status  | Evidence                                                                                                              |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Source repository   | Passed  | Public GitHub repository.                                                                                             |
| License             | Partial | Canonical Apache-2.0 corpus, package metadata, and REUSE checks; GitHub refresh pending.                              |
| Build system        | Passed  | `pnpm run build`.                                                                                                     |
| Tests               | Passed  | Unit, integration, conformance, coverage, e2e, smoke, and mutation scripts exist.                                     |
| CI                  | Passed  | `.github/workflows/ci.yml`.                                                                                           |
| Security policy     | Passed  | `SECURITY.md`.                                                                                                        |
| Contribution policy | Passed  | `CONTRIBUTING.md`, PR template, issue templates.                                                                      |
| Code of conduct     | Passed  | `CODE_OF_CONDUCT.md`.                                                                                                 |
| Dependency scanning | Passed  | Dependency review, audit, OSV, and security workflows.                                                                |
| SAST                | Passed  | CodeQL.                                                                                                               |
| Secrets scanning    | Passed  | Gitleaks helper and GitHub secret scanning configuration.                                                             |
| Release process     | Passed  | Protected `npm-publish` environment, OIDC trusted publishing, SBOM, checksums, provenance, and registry verification. |
| Human review        | Partial | Solo-maintainer model; independent review not yet available.                                                          |
| Governance          | Partial | Governance/maintainer docs exist; broader governance requires more maintainers.                                       |

## Human confirmation required

- Private vulnerability reporting enabled in GitHub UI.
- Third-party NOTICE requirements, if any.
- Independent environment approval after a second active maintainer joins.
- Published-registry provenance and attestation verification for each future release.

## Credential scope evidence

- `docs/security/github-actions-access-inventory.json` records the remaining GitHub Actions secret, its owner, consumer, purpose, rotation path, and the protected `npm-publish` environment.
- `scripts/check-security-tooling.mjs` rejects undocumented workflow secret references, broad write-all permissions, static npm credentials, and stale credential evidence.
