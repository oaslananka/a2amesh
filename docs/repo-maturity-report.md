# Repository maturity report

## Executive summary

A2A Mesh is close to **Professional OSS / Mature OSS** from an automation and documentation perspective, but it should not claim Gold or foundation-grade maturity yet. The strongest areas are TypeScript build/test automation, CI coverage, security workflows, release intent, and repository protection. The main gaps are human/process maturity: independent maintainers, recurring human review, contributor diversity, public release cadence evidence, private vulnerability reporting confirmation, and externally verified OpenSSF Best Practices Badge evidence.

Classification vocabulary: `Passed`, `Partial`, `Missing`, `Not applicable`, `Needs human confirmation`.

## Current maturity level

**Current level:** `Incubating-like / Professional OSS candidate`.

The project has professional automation and many mature repository health files, but contributor and governance signals are still early-stage. This is stronger than experimental/sandbox, but not yet foundation-grade.

## Target maturity level

**Target:** `Professional OSS / Mature OSS`.

Gold/foundation-grade is **not claimed**. It remains a future target requiring multiple maintainers, independent contributor/reviewer activity, documented review practice, repeatable releases, high test coverage, and sustainable governance.

## GitHub Community Standards status

| Criterion             | Status  | Evidence                                                                                                         |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| README                | Passed  | `README.md` exists and now links maturity/governance docs.                                                       |
| LICENSE               | Passed  | `LICENSE`, package `license`, and REUSE files exist; GitHub still reports `Other`, so detection needs follow-up. |
| CONTRIBUTING          | Passed  | `CONTRIBUTING.md` exists.                                                                                        |
| CODE_OF_CONDUCT       | Passed  | `CODE_OF_CONDUCT.md` exists.                                                                                     |
| SECURITY              | Passed  | `SECURITY.md` exists; private vulnerability reporting setting needs human confirmation.                          |
| SUPPORT               | Passed  | `SUPPORT.md` exists.                                                                                             |
| Issue templates       | Passed  | Bug, feature, and config templates exist.                                                                        |
| Pull request template | Passed  | `.github/PULL_REQUEST_TEMPLATE.md` exists.                                                                       |
| CODEOWNERS            | Partial | Added as ownership documentation; enforcement should wait for independent reviewers.                             |

## OpenSSF Best Practices status

| Area                    | Status  | Notes                                                                                                                          |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Passing readiness       | Partial | Build, tests, CI, security policy, contribution docs, and license evidence exist; BadgeApp claims still need human submission. |
| Silver readiness        | Partial | Strong automation exists; review independence, vulnerability process metrics, and release integrity evidence need more proof.  |
| Gold feasibility        | Missing | Gold requires multi-maintainer and human review maturity that is not currently present.                                        |
| `.bestpractices.json`   | Passed  | Local evidence pointer added.                                                                                                  |
| BadgeApp proposal links | Passed  | `docs/openssf-proposal-links.md` added.                                                                                        |
| Evidence file           | Passed  | `docs/openssf-evidence.md` added.                                                                                              |

## Scorecard readiness

| Check                  | Status         | Notes                                                                                            |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| Branch protection      | Passed         | `main` has required checks, no force push, no deletion, and admin enforcement.                   |
| Code review            | Partial        | Solo maintainer; bot review is not counted as human review.                                      |
| Maintained             | Passed         | Active recent commit and CI activity.                                                            |
| Security policy        | Passed         | `SECURITY.md` exists.                                                                            |
| License                | Partial        | License files exist; GitHub license detection still reports `Other`.                             |
| CI tests               | Passed         | CI runs lint, typecheck, unit, integration, build, package, conformance, and gc gates.           |
| Dependency update tool | Passed         | Dependabot security updates are enabled; config should remain monitored.                         |
| Pinned dependencies    | Partial        | Actions are pinned in core workflows where present; keep auditing workflow pins.                 |
| Token permissions      | Partial        | Workflows should continue using least privilege; new workflows must be reviewed for permissions. |
| Dangerous workflows    | Passed         | Existing security/zizmor/actionlint checks reduce risk.                                          |
| SAST                   | Passed         | CodeQL is present.                                                                               |
| Fuzzing                | Not applicable | No fuzzing harness identified; add only when a parser/protocol fuzz target is ready.             |

## Documentation maturity

| Diataxis area | Status  | Evidence                                                                                   |
| ------------- | ------- | ------------------------------------------------------------------------------------------ |
| Tutorial      | Passed  | `docs/tutorials/getting-started.md` added; existing quickstart remains primary.            |
| How-to guides | Partial | `docs/how-to/contribute-a-change.md` added; more task-oriented guides should follow.       |
| Reference     | Partial | `docs/reference/repository-standards.md` added; API/protocol refs already exist elsewhere. |
| Explanation   | Partial | `docs/explanation/architecture.md` added as a discoverability entry point.                 |

## Release maturity

| Criterion              | Status                   | Notes                                                                                                         |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Semantic Versioning    | Passed                   | Package versions and release tooling indicate semver-oriented releases.                                       |
| CHANGELOG              | Partial                  | `CHANGELOG.md` exists; Keep a Changelog conformance should be continuously checked.                           |
| GitHub Releases        | Needs human confirmation | Requires live release history confirmation.                                                                   |
| Release notes          | Partial                  | Release Please exists; ensure generated notes are published.                                                  |
| Release workflow       | Partial                  | `release-please.yml`, `publish.yml`, and package checks exist; release credentials/secrets are human-managed. |
| Checksums              | Partial                  | Release artifact docs exist; expand checksum publication evidence.                                            |
| Provenance/attestation | Partial                  | npm provenance config exists in packages; GitHub attestation policy needs confirmation.                       |

## Quality maturity

| Criterion         | Status | Evidence                                               |
| ----------------- | ------ | ------------------------------------------------------ |
| Lint              | Passed | `pnpm run lint`.                                       |
| Typecheck         | Passed | `pnpm run typecheck`.                                  |
| Unit tests        | Passed | `pnpm run test:unit`.                                  |
| Integration tests | Passed | `pnpm run test:integration`.                           |
| Coverage          | Passed | `pnpm run test:coverage`.                              |
| Quality gate      | Passed | `pnpm run verify`, `gc`, package dry-run, docs checks. |
| Test policy       | Passed | `docs/development/testing-policy.md` added.            |
| Coding standards  | Passed | `docs/development/coding-standards.md` added.          |

## Governance maturity

| Criterion              | Status  | Notes                                                                                            |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| Governance document    | Passed  | `GOVERNANCE.md` exists.                                                                          |
| Maintainers document   | Passed  | `MAINTAINERS.md` exists.                                                                         |
| Roadmap                | Passed  | `ROADMAP.md` added.                                                                              |
| CODEOWNERS             | Partial | Added for ownership; enforcement requires independent reviewers.                                 |
| Deprecation policy     | Partial | Documented in compatibility/release docs; needs explicit versioned deprecation policy expansion. |
| Backward compatibility | Partial | Protocol compatibility docs exist; maintain semver discipline.                                   |

## Community maturity

| Criterion                     | Status                   | Notes                                                                          |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| Time to first response        | Needs human confirmation | No public SLA evidence yet.                                                    |
| Issue resolution process      | Partial                  | Issue templates and roadmap tracker exist.                                     |
| PR review process             | Partial                  | PR template exists; independent human review is missing.                       |
| Contributor activity          | Needs human confirmation | Current evidence indicates solo-maintainer operation.                          |
| Bus factor / elephant factor  | Partial                  | High bus-factor risk due solo maintainer.                                      |
| Documentation discoverability | Partial                  | Diataxis entry points added; docs-site navigation may need follow-up.          |
| Change request acceptance     | Partial                  | CONTRIBUTING plus PR template exist; add maintainer review examples over time. |

## License/legal maturity

| Criterion                     | Status                   | Notes                                                                |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------- |
| LICENSE                       | Passed                   | Present.                                                             |
| SPDX/REUSE                    | Passed                   | REUSE check exists.                                                  |
| Third-party license awareness | Passed                   | Dependency license workflow/checks exist.                            |
| NOTICE                        | Needs human confirmation | Add only if dependencies or attribution requirements require it.     |
| GitHub license detection      | Partial                  | GitHub reports `Other`; investigate cache/formatting if it persists. |

## Security/supply-chain maturity

| Criterion                       | Status                   | Notes                                                                 |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Security policy                 | Passed                   | `SECURITY.md`.                                                        |
| Private vulnerability reporting | Needs human confirmation | Must be enabled in GitHub settings if available.                      |
| CodeQL                          | Passed                   | Workflow present.                                                     |
| Gitleaks                        | Passed                   | Security workflow runs gitleaks helper.                               |
| Dependency review               | Passed                   | Workflow present.                                                     |
| Dependabot/security updates     | Passed                   | Security updates are enabled.                                         |
| OSV                             | Passed                   | Security workflow includes OSV.                                       |
| SBOM                            | Partial                  | Release/package integrity docs should define SBOM publication.        |
| SLSA/provenance                 | Partial                  | npm provenance config exists; release attestation should be verified. |
| Token permissions               | Partial                  | Continue least-privilege review for every workflow.                   |

## Missing files

Resolved in this PR:

- `ROADMAP.md`
- `CODEOWNERS`
- `.bestpractices.json`
- `docs/repo-maturity-report.md`
- `docs/openssf-evidence.md`
- `docs/openssf-gap-analysis.md`
- `docs/openssf-proposal-links.md`
- Diataxis entry-point docs.
- Development policy docs.
- Security assurance docs.

## Missing workflows

No aggressive new workflow was added. The repository already has consolidated `ci.yml`, `codeql.yml`, `dependency-review.yml`, `scorecard.yml`, and `security.yml`. Separate `gitleaks.yml` and `release.yml` are not required while `security.yml`, `release-please.yml`, and `publish.yml` cover those responsibilities.

## Risky changes not applied

- Mandatory human PR review was not enabled because the project is currently solo-maintained.
- CODEOWNERS enforcement was not enabled.
- No release secret, npm token, or private vulnerability reporting setting was changed.
- No code behavior was changed.
- No package manager, lockfile, build system, or release mechanism was replaced.

## Recommended issues

1. Recruit at least one independent maintainer/reviewer and then enable mandatory PR review.
2. Confirm private vulnerability reporting in GitHub settings.
3. Investigate GitHub license detection reporting `Other` despite license files.
4. Add explicit SBOM publication to release artifacts.
5. Add release attestation verification instructions.
6. Add fuzzing harness only when stable protocol/parser targets are identified.
7. Publish contributor response/resolution targets after observing real community load.

## Next actions

1. Merge this low-risk maturity documentation PR after CI passes.
2. Submit/update the OpenSSF Best Practices BadgeApp entry using the evidence files.
3. Keep Gold/foundation-grade as a gap list only until independent governance exists.
4. Review docs-site navigation for the new Diataxis and maturity pages.
