# Comprehensive repository maturity audit

Status values: `Passed`, `Partial`, `Missing`, `Not applicable`, `Needs human confirmation`.

Priority values: `Required now`, `Recommended`, `Optional`, `Future`, `Not applicable`, `Needs human confirmation`.

<!-- repository-evidence:start -->

## Live repository evidence

Observed at **2026-07-23T22:30:45.116Z**. This generated section must be refreshed within 14 days from the machine-readable snapshot in [`docs/governance/repository-evidence.json`](governance/repository-evidence.json).

Refresh with `pnpm run repository:evidence:write`; CI validates freshness and local release parity through `pnpm run repository:evidence:check` in `docs:check`.

| Fact                         | Observed value                                                                                                     | Authoritative source                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Repository                   | [`oaslananka/a2amesh`](https://github.com/oaslananka/a2amesh); public; default branch `main`; license `Apache-2.0` | GitHub REST API: GET /repos/oaslananka/a2amesh                                                                            |
| Linked source version        | `0.13.0-alpha.1` across 6 public packages                                                                          | .release-please-manifest.json and release-tracked package.json files                                                      |
| npm publication              | `alpha` → `0.13.0-alpha.1`; `latest` → `0.1.0-alpha.1`                                                             | npm registry metadata for @a2amesh/runtime                                                                                |
| Latest canonical release tag | `@a2amesh/runtime-v0.13.0-alpha.1` at `405005305228`                                                               | GitHub REST API: releases/latest and tags for oaslananka/a2amesh                                                          |
| Latest GitHub Release        | None published                                                                                                     | GitHub REST API: releases/latest and tags for oaslananka/a2amesh                                                          |
| Active Release Please PR     | [#202](https://github.com/oaslananka/a2amesh/pull/202) proposes `0.14.0-alpha.1`                                   | GitHub CLI: pr list --repo oaslananka/a2amesh --state open                                                                |
| Open work                    | 15 issues and 2 pull requests (17 total)                                                                           | GitHub CLI: issue list --repo oaslananka/a2amesh --state open; GitHub CLI: pr list --repo oaslananka/a2amesh --state open |

### Manually verified repository settings

| Setting                         | Observed value                                                                                                                                                                                                                      | Owner       | Observation and cadence           | Source                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| Private vulnerability reporting | enabled                                                                                                                                                                                                                             | @oaslananka | 2026-07-23; refresh every 90 days | GitHub REST API: private-vulnerability-reporting                                    |
| Security analysis features      | secret scanning enabled; push protection enabled; Dependabot security updates enabled                                                                                                                                               | @oaslananka | 2026-07-23; refresh every 90 days | GitHub REST API: GET /repos/oaslananka/a2amesh                                      |
| main branch protection          | 18 required status checks; strict updates enabled; 0 required approvals; stale-review dismissal enabled; code-owner review disabled; last-push approval disabled; admin enforcement enabled; force pushes blocked; deletion blocked | @oaslananka | 2026-07-23; refresh every 90 days | GitHub REST API: branch protection                                                  |
| npm-publish environment         | branches main; reviewers oaslananka; self-review allowed; 0 static environment secrets; OIDC trusted publishing                                                                                                                     | @oaslananka | 2026-07-23; refresh every 90 days | GitHub REST API: environments/npm-publish, branch policies, and environment secrets |

<!-- repository-evidence:end -->

## 1. Executive summary

A2A Mesh is a TypeScript/pnpm monorepo with CLI, runtime, registry, protocol, MCP, adapter, documentation, and npm publishing surfaces. The current maturity is **Incubating-like / Professional OSS candidate**. The correct target is **Professional OSS / Mature OSS** with **OpenSSF Passing readiness** and later **Silver readiness** after sustained release and independent-review evidence. Gold/foundation-grade is not claimed because the project is solo-maintained and lacks independent human review evidence.

| Area                  | Current state                                                         | Target state                             | Status  | Risk   | Recommended action                                           |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------- | ------- | ------ | ------------------------------------------------------------ |
| Overall maturity      | Strong automation and docs, but solo-maintainer process risk remains. | Professional OSS / Mature OSS.           | Partial | Medium | Continue process hardening and recruit independent reviewer. |
| Gold/foundation-grade | No evidence of multiple maintainers or recurring independent review.  | Gap-only until evidence exists.          | Missing | High   | Do not claim Gold.                                           |
| Safe refactor scope   | Docs and metadata only.                                               | Low-risk reversible professionalization. | Passed  | Low    | Keep behavior changes separate.                              |

## 2. Current maturity level

| Area                 | Current state                                                      | Target state                                              | Status  | Risk   | Recommended action                       |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- | ------- | ------ | ---------------------------------------- |
| CNCF-style level     | Incubating-like.                                                   | Professional OSS / Mature OSS.                            | Partial | Medium | Build release and contributor evidence.  |
| Stability claim      | Current linked version and prerelease channel are generated above. | Clear pre-1.0 compatibility/deprecation policy.           | Partial | Medium | Maintain API stability docs.             |
| Production readiness | CI is mature; adoption/release history is still early.             | Production readiness only after release cadence evidence. | Partial | Medium | Avoid production readiness overclaiming. |

## 3. Target maturity level

| Area        | Current state                                | Target state                                     | Status  | Risk   | Recommended action                    |
| ----------- | -------------------------------------------- | ------------------------------------------------ | ------- | ------ | ------------------------------------- |
| Near-term   | Public package with professional automation. | OpenSSF Passing readiness.                       | Partial | Low    | Use evidence docs for BadgeApp.       |
| Medium-term | Release integrity needs confirmation.        | OpenSSF Silver readiness.                        | Partial | Medium | Add release SBOM/provenance evidence. |
| Long-term   | Solo maintainer.                             | Foundation-grade only after governance maturity. | Future  | High   | Track Gold gaps separately.           |

## 4. Repository inventory

| Area               | Current state                                                                                        | Target state                              | Status  | Risk   | Recommended action                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------- | ------ | ----------------------------------------------------------- |
| Visibility         | Live repository visibility is generated above.                                                       | Public OSS.                               | Passed  | Low    | Keep policy docs visible.                                   |
| Default branch     | Live default branch is generated above.                                                              | Protected default branch.                 | Passed  | Low    | Keep checks aligned.                                        |
| License            | Canonical Apache-2.0/REUSE corpus is validated locally; live repository metadata is generated above. | Apache-2.0 detected.                      | Partial | Medium | Use the generated repository evidence for current metadata. |
| Maintained         | Open-work and release observations are generated above.                                              | Active maintained release cadence.        | Partial | Low    | Keep releases/changelog current.                            |
| Archive/deprecated | Live archive state is generated above.                                                               | No deprecation signal unless intentional. | Passed  | Low    | Keep README status clear.                                   |

## 5. Language and package ecosystem inventory

| Area                  | Current state                                                                 | Target state                     | Status         | Risk   | Recommended action             |
| --------------------- | ----------------------------------------------------------------------------- | -------------------------------- | -------------- | ------ | ------------------------------ |
| Primary language      | TypeScript.                                                                   | TypeScript standards documented. | Passed         | Low    | Keep coding standards doc.     |
| Package manager       | pnpm 11.8.0 with lockfile.                                                    | Keep pnpm; do not switch.        | Passed         | Low    | Use frozen lockfile.           |
| Monorepo              | Workspace with publishable and internal packages.                             | Package surfaces checked.        | Passed         | Medium | Keep package dry-run.          |
| Build/test            | pnpm scripts, TypeScript, Vitest, integration/conformance/e2e/smoke/mutation. | CI quality gates.                | Passed         | Medium | Track slow/flaky tests.        |
| Docs generator        | VitePress, TypeDoc, OpenAPI generation.                                       | Docs build/checks required.      | Passed         | Low    | Keep docs gates.               |
| Docker/Python/Go/Rust | No primary product evidence.                                                  | Not applicable unless added.     | Not applicable | Low    | Do not add irrelevant tooling. |

## 6. Publishing and release inventory

| Area                         | Current state                                                                                            | Target state                                            | Status         | Risk   | Recommended action                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------- | ------ | --------------------------------------------------------------------------- |
| npm scoped packages          | Publishable packages include `@a2amesh/cli`, `create-a2amesh`, `mcp`, `protocol`, `registry`, `runtime`. | Release workflow validates and publishes intentionally. | Partial        | Medium | Confirm npm trusted publishing/OIDC.                                        |
| CLI binary                   | CLI, create CLI, and registry bin metadata exist.                                                        | Bin package dry-runs validated.                         | Passed         | Medium | Keep package checks required.                                               |
| npm provenance               | `publishConfig.provenance: true` exists.                                                                 | Provenance verified after releases.                     | Partial        | Medium | Add release verification evidence.                                          |
| GitHub Releases              | Current GitHub Release, canonical tag, and active Release Please PR facts are generated above.           | Release notes, tags, artifacts, provenance.             | Partial        | Medium | Use generated release facts and verify release artifacts after publication. |
| PyPI/Docker/Homebrew/VS Code | No publish evidence identified.                                                                          | Not applicable unless a product surface is added.       | Not applicable | Low    | Do not add unused publish workflows.                                        |
| Documentation site           | Documentation-site configuration exists in the repository.                                               | Docs workflow deploys reliably.                         | Passed         | Low    | Keep docs workflow green.                                                   |

## 7. GitHub Community Standards status

| Area               | Current state                                           | Target state                                | Status  | Risk   | Recommended action                        |
| ------------------ | ------------------------------------------------------- | ------------------------------------------- | ------- | ------ | ----------------------------------------- |
| README             | Exists and badge area cleaned.                          | Clear scope, install, trust, support links. | Passed  | Low    | Avoid badge sprawl.                       |
| LICENSE            | Canonical corpus is validated locally.                  | GitHub-detected Apache-2.0.                 | Partial | Low    | Use generated repository metadata.        |
| CONTRIBUTING       | Exists.                                                 | Predictable contributor path.               | Passed  | Low    | Keep linked from README.                  |
| CODE_OF_CONDUCT    | Exists.                                                 | Visible community policy.                   | Passed  | Low    | Maintain.                                 |
| SECURITY           | Exists; the live repository setting is generated above. | Private reporting enabled.                  | Partial | Medium | Keep generated settings evidence current. |
| SUPPORT            | Exists.                                                 | Clear support boundaries.                   | Passed  | Low    | Keep donation secondary.                  |
| Issue/PR templates | Exist.                                                  | Structured triage and review.               | Passed  | Low    | Keep aligned with process.                |

## 8. OpenSSF Best Practices status

| Area                  | Current state                                                               | Target state                    | Status  | Risk   | Recommended action                          |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------- | ------- | ------ | ------------------------------------------- |
| Passing readiness     | Evidence/gap/proposal docs exist.                                           | Human BadgeApp submission.      | Partial | Medium | Submit using evidence docs.                 |
| Silver readiness      | Security/CI docs strong; release integrity and human process need evidence. | Silver after confirmation.      | Partial | Medium | Confirm vulnerability and release evidence. |
| Gold feasibility      | Solo maintainer; no independent review proof.                               | Gap-only.                       | Missing | High   | Do not claim Gold.                          |
| `.bestpractices.json` | Exists.                                                                     | Keep current.                   | Passed  | Low    | Update after process changes.               |
| Evidence docs         | Exist.                                                                      | Map to claims, no overclaiming. | Passed  | Low    | Keep factual.                               |

## 9. OpenSSF Scorecard readiness

| Area              | Current state                                                                     | Target state                                | Status  | Risk   | Recommended action                        |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------- | ------- | ------ | ----------------------------------------- |
| Branch protection | Live required checks and review controls are generated above.                     | Contexts aligned with workflow names.       | Passed  | Low    | Re-check after workflow changes.          |
| Code review       | Governance remains solo-maintainer; live review controls are generated above.     | Enable after independent reviewer exists.   | Partial | Medium | Track governance issue.                   |
| Maintained        | Live open-work and release observations are generated above.                      | Sustained releases.                         | Partial | Low    | Keep changelog and releases current.      |
| Security policy   | Exists; the live repository setting is generated above.                           | Private reporting enabled.                  | Partial | Medium | Keep generated settings evidence current. |
| License           | Canonical files are validated locally; live license metadata is generated above.  | Apache-2.0 detected.                        | Partial | Medium | Use generated repository metadata.        |
| CI tests          | Broad required jobs.                                                              | Passing and required.                       | Passed  | Low    | Keep required.                            |
| Dependency update | Renovate configuration exists; live Dependabot security state is generated above. | No conflicting version bots.                | Partial | Medium | Audit Renovate/Dependabot behavior.       |
| SAST/secrets/deps | CodeQL, gitleaks, OSV, dependency review.                                         | Required security gates.                    | Passed  | Low    | Keep required.                            |
| Fuzzing           | No fuzz harness identified.                                                       | Add only for stable parser/protocol target. | Future  | Medium | Create issue when target exists.          |

## 10. Documentation maturity

| Area            | Current state                              | Target state                           | Status  | Risk | Recommended action               |
| --------------- | ------------------------------------------ | -------------------------------------- | ------- | ---- | -------------------------------- |
| Tutorials       | Getting-started and quickstart exist.      | More scenario tutorials.               | Partial | Low  | Add as product stabilizes.       |
| How-to          | Contribution how-to exists.                | More task guides.                      | Partial | Low  | Add operator/publishing how-tos. |
| Reference       | Repo standards plus protocol/package docs. | Config and compatibility entry points. | Partial | Low  | Keep reference docs current.     |
| Explanation     | Architecture explanation exists.           | More rationale/ADRs.                   | Partial | Low  | Keep ADRs current.               |
| Troubleshooting | Existing troubleshooting.                  | Linked from setup docs.                | Passed  | Low  | Maintain.                        |

## 11. Release maturity

| Area                      | Current state                                                                 | Target state                                | Status  | Risk   | Recommended action                                       |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ------- | ------ | -------------------------------------------------------- |
| SemVer                    | Pre-1.0 alpha packages.                                                       | Clear pre-1.0 compatibility discipline.     | Partial | Medium | Use API/deprecation docs.                                |
| Conventional Commits      | Documented and release automation present.                                    | Release automation consumes commit history. | Passed  | Low    | Keep PR titles conventional.                             |
| Release Please            | Config and manifest exist; active Release Please PR state is generated above. | Stable release PR workflow.                 | Partial | Medium | Use generated release facts for the current next action. |
| Changelog/release notes   | Changelog exists.                                                             | Generated/curated release notes.            | Partial | Low    | Verify after release.                                    |
| Checksums/SBOM/provenance | Target documented; evidence incomplete.                                       | Published verification evidence.            | Partial | Medium | Track release integrity issue.                           |
| Rollback/deprecation      | Needs explicit policy.                                                        | Documented policy.                          | Partial | Medium | Add deprecation policy doc.                              |

## 12. Package publishing maturity

| Area                   | Current state                                                                                              | Target state                                    | Status                   | Risk   | Recommended action                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------ | ------ | --------------------------------------------------------------- |
| npm metadata           | Names, versions, license, types, bin/exports, publishConfig exist.                                         | Package dry-run/publint/attw green.             | Passed                   | Medium | Keep `check:packages`.                                          |
| npm trusted publishing | Provenance and OIDC workflow configuration exist; current GitHub environment controls are generated above. | OIDC/trusted publishing over long-lived tokens. | Needs human confirmation | High   | Verify registry-side trusted-publisher evidence during release. |
| PyPI                   | No Python package.                                                                                         | Not applicable.                                 | Not applicable           | Low    | Do not add workflow.                                            |
| Docker                 | No independent container-publishing product surface is declared.                                           | Not applicable.                                 | Not applicable           | Low    | Do not add workflow.                                            |
| Registry README        | README exists and improved.                                                                                | Registry view clear.                            | Partial                  | Low    | Verify after package publish.                                   |

## 13. Quality and test maturity

| Area           | Current state                                                                   | Target state                               | Status  | Risk   | Recommended action                        |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------ | ------- | ------ | ----------------------------------------- |
| Lint/format    | ESLint, markdownlint, yaml, identity, Prettier.                                 | Required quality gates.                    | Passed  | Low    | Keep required checks.                     |
| Typecheck      | TypeScript typecheck scripts.                                                   | Required in CI.                            | Passed  | Low    | Keep required.                            |
| Tests          | Unit, integration, conformance, e2e, smoke, and mutation layers are configured. | Test layers aligned to risk.               | Passed  | Medium | Manage slow tests and timeouts.           |
| Coverage       | Coverage script exists.                                                         | Threshold policy documented and realistic. | Partial | Medium | Do not raise thresholds without evidence. |
| Package checks | Package dry-run and surface checks.                                             | Required before publish.                   | Passed  | Medium | Keep release gates.                       |

## 14. Dependency management maturity

| Area              | Current state                                                   | Target state                                 | Status  | Risk   | Recommended action                  |
| ----------------- | --------------------------------------------------------------- | -------------------------------------------- | ------- | ------ | ----------------------------------- |
| Renovate          | `renovate.json` exists.                                         | Primary version-update bot.                  | Partial | Medium | Audit grouping/automerge rules.     |
| Dependabot        | Security updates enabled; no version config.                    | Security alerts ok; avoid conflicting bots.  | Partial | Low    | Do not add version updates blindly. |
| Dependency review | Workflow exists; live required-check status is generated above. | Required on PRs.                             | Passed  | Low    | Keep required.                      |
| Audit             | pnpm audit/security scripts.                                    | Required high-severity gate.                 | Passed  | Low    | Keep security workflow.             |
| Update policy     | Dependency doc exists.                                          | Runtime/security-sensitive updates reviewed. | Passed  | Medium | Keep automerge conservative.        |

## 15. Governance maturity

| Area                 | Current state                            | Target state                                 | Status  | Risk   | Recommended action            |
| -------------------- | ---------------------------------------- | -------------------------------------------- | ------- | ------ | ----------------------------- |
| Maintainers          | Maintainers/governance/CODEOWNERS exist. | Multi-maintainer governance.                 | Partial | Medium | Recruit independent reviewer. |
| Contribution process | CONTRIBUTING and PR template.            | Predictable merge process.                   | Passed  | Low    | Keep PR evidence.             |
| Roadmap              | Exists.                                  | Linked to milestones/issues.                 | Passed  | Low    | Keep current.                 |
| CODEOWNERS           | Ownership docs only.                     | Enforcement only after independent reviewer. | Partial | Medium | Do not enable prematurely.    |
| Branch protection    | Live configuration is generated above.   | Required checks and no force/delete.         | Passed  | Low    | Keep contexts aligned.        |

## 16. Community health maturity

| Area                   | Current state                          | Target state                      | Status                   | Risk   | Recommended action            |
| ---------------------- | -------------------------------------- | --------------------------------- | ------------------------ | ------ | ----------------------------- |
| Time to first response | No public metric evidence.             | Track after external usage grows. | Needs human confirmation | Medium | Add metrics later.            |
| Issue triage           | Templates/labels exist.                | Good-first/help-wanted process.   | Partial                  | Low    | Curate beginner issues.       |
| PR review duration     | Solo maintainer.                       | Measured independent review.      | Partial                  | Medium | Recruit reviewer.             |
| Contributor activity   | No independent evidence in this audit. | Contributor diversity.            | Missing                  | High   | Do not claim Gold.            |
| Bus factor             | Solo-maintainer risk.                  | At least two maintainers.         | Partial                  | High   | Treat as top governance risk. |

## 17. License/legal maturity

| Area                | Current state                                      | Target state                         | Status                   | Risk   | Recommended action                          |
| ------------------- | -------------------------------------------------- | ------------------------------------ | ------------------------ | ------ | ------------------------------------------- |
| LICENSE             | Present; live license metadata is generated above. | Apache-2.0 metadata remains aligned. | Partial                  | Medium | Keep generated repository evidence current. |
| Package licenses    | Apache-2.0 metadata.                               | Consistent across packages.          | Passed                   | Low    | Keep checks.                                |
| REUSE               | Config and checks.                                 | REUSE passing in CI.                 | Passed                   | Low    | Keep annotations.                           |
| NOTICE              | Not present.                                       | Add only if legally required.        | Needs human confirmation | Medium | Review obligations.                         |
| Third-party notices | Not present.                                       | Add only if required.                | Needs human confirmation | Medium | Avoid boilerplate without need.             |

## 18. Security/supply-chain maturity

| Area               | Current state                           | Target state                                                              | Status  | Risk   | Recommended action                                    |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------- | ------- | ------ | ----------------------------------------------------- |
| SECURITY.md        | Present.                                | Live private-reporting state is generated above.                          | Partial | Medium | Keep generated settings evidence current.             |
| Threat model       | Present.                                | Updated with architecture changes.                                        | Passed  | Medium | Maintain.                                             |
| Gitleaks/OSV/audit | Present in security workflow.           | Required gates.                                                           | Passed  | Low    | Keep required.                                        |
| SBOM/provenance    | Target documented; not fully evidenced. | Release verification artifacts.                                           | Partial | Medium | Track release issue.                                  |
| Secrets management | Policy doc added.                       | No long-lived publishing token; live GitHub controls are generated above. | Partial | High   | Keep access inventory and generated evidence current. |

## 19. Developer experience maturity

| Area                  | Current state                | Target state                    | Status   | Risk   | Recommended action             |
| --------------------- | ---------------------------- | ------------------------------- | -------- | ------ | ------------------------------ |
| Local setup           | Setup script and setup docs. | Single-path setup.              | Passed   | Low    | Keep local setup doc current.  |
| One-command checks    | Fast and full scripts exist. | Clear validation tiers.         | Passed   | Medium | Document timeout expectations. |
| Troubleshooting       | Existing doc.                | Linked from setup/contributing. | Passed   | Low    | Maintain.                      |
| `.env.example`        | Present.                     | Non-sensitive placeholders.     | Passed   | Low    | Keep safe.                     |
| Devcontainer/taskfile | Not present.                 | Optional.                       | Optional | Low    | Add only if friction appears.  |

## 20. API/CLI stability

| Area          | Current state                                    | Target state                                  | Status  | Risk   | Recommended action           |
| ------------- | ------------------------------------------------ | --------------------------------------------- | ------- | ------ | ---------------------------- |
| Public API    | Published package exports and protocol behavior. | Compatibility-sensitive changes documented.   | Partial | Medium | Keep API stability doc.      |
| CLI commands  | Examples and command docs.                       | Breaking CLI changes require migration notes. | Partial | Medium | Keep command-surface checks. |
| MCP schema    | MCP package exists.                              | Schema changes versioned.                     | Partial | Medium | Treat as API-impacting.      |
| Config schema | Reference entry point added.                     | Package-specific config refs.                 | Partial | Low    | Expand over time.            |
| Deprecation   | Policy added.                                    | Deprecations documented and delayed.          | Passed  | Medium | Enforce in release notes.    |

## 21. README and badge review

| Area             | Current state                                  | Target state                         | Status | Risk | Recommended action         |
| ---------------- | ---------------------------------------------- | ------------------------------------ | ------ | ---- | -------------------------- |
| Badge density    | Package and workflow badge rows are separated. | Low-noise hero.                      | Passed | Low  | Avoid adding noisy badges. |
| Downloads        | npm total downloads badge.                     | Adoption separate from quality.      | Passed | Low  | Keep as total downloads.   |
| Broken badges    | Invalid Scorecard API badge removed.           | Only working evidence-backed badges. | Passed | Low  | Prefer workflow badges.    |
| Support/donation | Coffee button below intro.                     | Support secondary, not dominant.     | Passed | Low  | Keep measured placement.   |

## 22. Safe refactor opportunities

| Area                | Current state          | Target state                              | Status | Risk   | Recommended action           |
| ------------------- | ---------------------- | ----------------------------------------- | ------ | ------ | ---------------------------- |
| Documentation-only  | Applied.               | Better discoverability.                   | Passed | Low    | Continue small docs PRs.     |
| Metadata-only       | Applied where factual. | Better maturity evidence.                 | Passed | Low    | Keep factual.                |
| README architecture | Applied.               | Clean hero/resource links.                | Passed | Low    | Avoid badge sprawl.          |
| Workflow-only       | Not changed here.      | Separate workflow audit PR.               | Future | Medium | Change workflows separately. |
| Code refactor       | Not applied.           | Only after test baseline and risk review. | Future | Medium | Keep out of maturity PR.     |

## 23. High-risk refactor opportunities

| Area                       | Current state        | Target state                        | Status                   | Risk   | Recommended action                   |
| -------------------------- | -------------------- | ----------------------------------- | ------------------------ | ------ | ------------------------------------ |
| Public API changes         | Not applied.         | Separate design/test PRs.           | Future                   | High   | Open issue first.                    |
| CLI command changes        | Not applied.         | Migration notes and command checks. | Future                   | High   | Avoid in maturity PR.                |
| Publish workflow changes   | Not applied.         | Trusted publishing verified.        | Future                   | High   | Require human registry confirmation. |
| Package manager changes    | Not applied.         | Keep pnpm.                          | Not applicable           | High   | Do not change.                       |
| Branch protection settings | Not applied by code. | Manual settings only.               | Needs human confirmation | Medium | Keep in manual checklist.            |

## 24. Files to add/update

| Area                     | Current state                      | Target state                      | Status                   | Risk   | Recommended action                      |
| ------------------------ | ---------------------------------- | --------------------------------- | ------------------------ | ------ | --------------------------------------- |
| Maturity report          | Expanded to comprehensive format.  | Current after major repo changes. | Passed                   | Low    | Update after releases/workflow changes. |
| Professionalization plan | Added.                             | Actionable roadmap.               | Passed                   | Low    | Link from issues/milestones.            |
| Development docs         | API/deprecation/local setup added. | Discoverable contributor docs.    | Passed                   | Low    | Keep references current.                |
| Security docs            | Secrets management added.          | Security process visible.         | Passed                   | Medium | Verify settings manually.               |
| NOTICE/third-party       | Not added.                         | Add only if obligations require.  | Needs human confirmation | Medium | Legal review first.                     |

## 25. Workflows to add/update

| Area                  | Current state                                                                       | Target state                 | Status         | Risk | Recommended action                    |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------- | -------------- | ---- | ------------------------------------- |
| CI                    | Broad workflow configuration exists; live required-check status is generated above. | Required on main.            | Passed         | Low  | No change in this PR.                 |
| CodeQL                | Exists.                                                                             | Required SAST.               | Passed         | Low  | No change.                            |
| Scorecard             | Exists.                                                                             | Required repo health signal. | Passed         | Low  | No change.                            |
| Security/gitleaks/OSV | Consolidated in security workflow.                                                  | Required security gates.     | Passed         | Low  | No separate gitleaks workflow needed. |
| Release/publish       | Release Please and publish workflows exist.                                         | Verified trusted publishing. | Partial        | High | Audit separately before changing.     |
| Docker/PyPI           | No product evidence.                                                                | Not applicable.              | Not applicable | Low  | Do not add unused workflows.          |

## 26. Manual GitHub settings required

| Area                            | Current state                                                                                      | Target state                                       | Status                   | Risk   | Recommended action                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------ | ------ | ----------------------------------------- |
| Branch protection/rulesets      | Current branch protection is generated above.                                                      | Required checks current.                           | Passed                   | Medium | Refresh evidence after workflow changes.  |
| Required PR review              | Current approval and review flags are generated above.                                             | Enable independent approval after reviewer growth. | Partial                  | Medium | Follow the governance transition policy.  |
| Private vulnerability reporting | Current enabled state is generated above.                                                          | Enabled.                                           | Partial                  | Medium | Keep generated settings evidence current. |
| Dependabot alerts/security      | Current Dependabot security-update state is generated above.                                       | Remain enabled.                                    | Partial                  | Low    | Refresh generated settings evidence.      |
| Secret scanning/push protection | Current secret-scanning and push-protection state is generated above.                              | Remain enabled where available.                    | Partial                  | Medium | Refresh generated settings evidence.      |
| npm trusted publishing          | GitHub OIDC and environment controls are generated above; registry-side trust is release evidence. | OIDC/trusted publishing.                           | Partial                  | High   | Verify registry evidence during release.  |
| OpenSSF BadgeApp                | Not automatic.                                                                                     | Human submission/approval.                         | Needs human confirmation | Low    | Use evidence docs.                        |

## 27. Recommended issues

| Area                    | Current state           | Target state                            | Status | Risk   | Recommended action                  |
| ----------------------- | ----------------------- | --------------------------------------- | ------ | ------ | ----------------------------------- |
| Independent review      | Issue exists.           | Multi-maintainer review process.        | Passed | Medium | Keep open until resolved.           |
| Vulnerability reporting | Issue exists.           | Confirmed private reporting.            | Passed | Medium | Update evidence after confirmation. |
| License detection       | Issue exists.           | GitHub detects Apache-2.0.              | Passed | Medium | Investigate cache/layout.           |
| Release integrity       | Issue exists.           | SBOM/provenance evidence.               | Passed | Medium | Tie to release workflow.            |
| Fuzzing                 | No specific target yet. | Add when parser/protocol target exists. | Future | Medium | Create target-specific issue later. |

## 28. Recommended next actions

| Area           | Current state                                       | Target state                                     | Status       | Risk   | Recommended action                        |
| -------------- | --------------------------------------------------- | ------------------------------------------------ | ------------ | ------ | ----------------------------------------- |
| Merge this PR  | Documentation-only safe improvements.               | Comprehensive maturity baseline on main.         | Required now | Low    | Merge after CI passes.                    |
| Release PR     | Current Release Please PR state is generated above. | Valid release flow.                              | Required now | Medium | Act on the generated release evidence.    |
| Open PRs       | Current open-work counts are generated above.       | Keep open work triaged.                          | Recommended  | Medium | Use generated counts and issue labels.    |
| BadgeApp       | Evidence ready but not submitted.                   | OpenSSF Passing after human review.              | Recommended  | Low    | Submit manually.                          |
| Gold readiness | Organizational gaps remain.                         | Foundation-grade only after governance maturity. | Future       | High   | Recruit maintainers and collect evidence. |
