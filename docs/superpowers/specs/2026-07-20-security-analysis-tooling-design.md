# Repository-owned Semgrep policy design

## Decision

Keep CodeQL as the broad SAST gate and add Semgrep only for high-confidence A2A Mesh rules that are difficult to express through the language linter. Keep SonarQube Cloud as the maintainability GitHub App. Do not restore Snyk after its account and quota limits made it an unreliable CI dependency; Dependency Review, pnpm audit, OSV-Scanner, and Socket retain dependency-security responsibilities.

## Scope

The implementation adds four blocking Semgrep rules, a stable required `Security / semgrep` job, a changed-file pre-commit hook, Renovate management for the pinned Semgrep release, documentation, and contract tests.

## Non-goals

- replacing CodeQL;
- running Semgrep's broad hosted policy;
- restoring Snyk Open Source or Snyk Code;
- replacing SonarQube Cloud automatic analysis;
- adding another Trivy workflow.

## Safety properties

The scan is tokenless and fork-safe. Every rule is severity `ERROR`. The workflow and pre-commit hook use exact Semgrep `1.170.0`, and Renovate owns future upgrades. Repository validation rejects reintroduced Snyk gates, broad Semgrep platform scans, and removal of the required Semgrep status check.
