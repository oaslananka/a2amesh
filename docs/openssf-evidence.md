# OpenSSF evidence

This file records evidence for OpenSSF Best Practices and Scorecard-oriented review. It is not a badge claim by itself.

## Project metadata

- Repository: `https://github.com/oaslananka/a2amesh`
- Language/runtime: TypeScript / Node.js / pnpm workspace
- Package manager: `pnpm@11.7.0`
- Target maturity: Professional OSS / Mature OSS
- Gold claim: No

## Evidence matrix

| Area                | Status  | Evidence                                                                           |
| ------------------- | ------- | ---------------------------------------------------------------------------------- |
| Source repository   | Passed  | Public GitHub repository.                                                          |
| License             | Partial | `LICENSE`, package metadata, REUSE checks. GitHub detection still needs follow-up. |
| Build system        | Passed  | `pnpm run build`.                                                                  |
| Tests               | Passed  | Unit, integration, conformance, coverage, e2e, smoke, and mutation scripts exist.  |
| CI                  | Passed  | `.github/workflows/ci.yml`.                                                        |
| Security policy     | Passed  | `SECURITY.md`.                                                                     |
| Contribution policy | Passed  | `CONTRIBUTING.md`, PR template, issue templates.                                   |
| Code of conduct     | Passed  | `CODE_OF_CONDUCT.md`.                                                              |
| Dependency scanning | Passed  | Dependency review, audit, OSV, and security workflows.                             |
| SAST                | Passed  | CodeQL.                                                                            |
| Secrets scanning    | Passed  | Gitleaks helper and GitHub secret scanning configuration.                          |
| Release process     | Partial | Release Please/publish workflows exist; release attestation must be verified.      |
| Human review        | Partial | Solo-maintainer model; independent review not yet available.                       |
| Governance          | Partial | Governance/maintainer docs exist; broader governance requires more maintainers.    |

## Human confirmation required

- Private vulnerability reporting enabled in GitHub UI.
- GitHub Releases and npm provenance are publishing expected artifacts.
- Third-party NOTICE requirements, if any.
- Whether release SBOMs and attestations are published for all packages.
