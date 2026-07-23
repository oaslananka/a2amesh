# Trust Evidence

This page maps A2A Mesh repository practices to public evidence that reviewers can use for README badges, bestpractice.dev submissions, OpenSSF Scorecard review, and release-trust checks.

## README signal set

The README exposes only signals backed by repository automation or published package metadata:

| Signal            | Evidence                                                                                                                                                                                                                | Owner check                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| CI                | `.github/workflows/ci.yml` runs install, lint, typecheck, unit, integration, conformance, packaging, public-surface, schema, consumer, and compatibility jobs; `CI / tests-required` summarizes required test evidence. | PR checks must be green before merge.                              |
| Docs              | `.github/workflows/docs.yml` runs markdown lint, docs build, command parity, and public-link checks where applicable.                                                                                                   | Docs changes must pass `Docs / build` and `Docs / command-parity`. |
| Security          | `.github/workflows/security.yml` runs REUSE, actionlint, audit, gitleaks, zizmor, OSV, and dependency-license checks.                                                                                                   | Security checks must be green before release.                      |
| CodeQL            | `.github/workflows/codeql.yml` runs GitHub code scanning for the TypeScript workspace.                                                                                                                                  | CodeQL must finish successfully on pull requests.                  |
| Dependency Review | `.github/workflows/dependency-review.yml` blocks unsafe dependency changes.                                                                                                                                             | Dependency changes require a clean review job.                     |
| OpenSSF Scorecard | `.github/workflows/scorecard.yml` runs OpenSSF Scorecard and uploads SARIF when allowed.                                                                                                                                | Scorecard findings are triaged as security or governance work.     |
| npm package       | Public npm package metadata is linked from the README for `@a2amesh/runtime`.                                                                                                                                           | Release verification checks every public package.                  |
| License           | Apache-2.0 license and REUSE metadata are checked in CI.                                                                                                                                                                | `Security / REUSE` must pass.                                      |

## bestpractice.dev evidence map

Use this table when filling out bestpractice.dev or similar repository-quality reviews. Link to the evidence file or workflow instead of making unsupported claims.

| Practice area                | Evidence path                                                                                        | What it proves                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Maintained source repository | `README.md`, `CHANGELOG.md`, `.github/workflows/ci.yml`                                              | Project purpose, release history, and active CI.              |
| License clarity              | `LICENSE`, `REUSE.toml`, `Security / REUSE` check                                                    | Apache-2.0 licensing and REUSE guardrail.                     |
| Security policy              | `SECURITY.md`, `docs/security/threat-model.md`                                                       | Vulnerability reporting and threat-model coverage.            |
| Contribution policy          | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`                                             | Contributor workflow and project governance.                  |
| Branch and release quality   | `docs/release/process.md`, `docs/release/branch-protection.md`                                       | Release path and expected protected-branch checks.            |
| Dependency controls          | `.github/workflows/dependency-review.yml`, `docs/security/third-party-dependencies.md`               | Dependency review and third-party dependency policy.          |
| Static analysis              | `.github/workflows/codeql.yml`, `.github/workflows/security.yml`                                     | CodeQL, audit, secret scan, workflow lint, and policy checks. |
| Supply-chain evidence        | `docs/security/supply-chain.md`, `docs/release/package-verification.md`                              | Package checksums, SBOM, provenance, and parity evidence.     |
| Protocol conformance         | `docs/protocol/compliance.md`, `docs/protocol/profiles.md`, `.github/workflows/ci.yml`               | A2A profile coverage and CI conformance jobs.                 |
| Public API stability         | `docs/protocol/schemas.md`, `docs/openapi/registry.openapi.json`, `scripts/check-public-surface.mjs` | Public schema, OpenAPI, and exported-surface guardrails.      |

## OpenSSF Scorecard triage

Scorecard is treated as a signal, not a marketing claim. When the Scorecard workflow reports a regression:

1. Open or update a security/governance issue with the failing check name.
2. Link the workflow run and relevant repository evidence.
3. Fix the source control, release, dependency, or documentation gap.
4. Keep the README badge pointing to the workflow or Scorecard project only while the signal is truthful.

Do not manually edit score values into docs. Use badges and links that resolve to current workflow or Scorecard output.

## Release-trust evidence

For every release, keep the evidence listed in the package verification guide:

- Git tag and commit SHA.
- Publish workflow run URL.
- npm package version and dist-tag output.
- Tarball checksums and npm integrity values.
- SBOM checksum.
- npm provenance summary.
- `release:state`, `release:preflight`, `release:validate`, and `release:parity` output.

This evidence should be linked from release issues, release notes, or follow-up trust-review issues rather than duplicated in README badges.

## Badge maintenance rules

- Keep badges truthful and backed by automation.
- Remove or downgrade badges when the backing workflow is deleted, renamed, or no longer required.
- Prefer workflow and package badges over static quality claims.
- Do not add badges for services that require private dashboards unless the public README link works without special access.
