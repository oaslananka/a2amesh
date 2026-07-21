# Repository-owned Semgrep policy design

## Decision

Keep CodeQL as the broad SAST gate and add Semgrep only for high-confidence A2A Mesh rules that are difficult to express through the language linter. Keep the existing Snyk and SonarQube Cloud GitHub Apps instead of adding duplicate CLI workflows.

## Scope

The implementation adds four blocking Semgrep rules, a stable `Security / semgrep` job, a changed-file pre-commit hook, Renovate management for the pinned Semgrep release, documentation, and contract tests.

## Non-goals

- replacing CodeQL;
- running Semgrep's broad hosted policy;
- adding a second Snyk Open Source or Snyk Code gate;
- replacing SonarQube Cloud automatic analysis;
- adding another Trivy workflow.

## Safety properties

The scan is tokenless and fork-safe. Every rule is severity `ERROR`. The workflow and pre-commit hook use exact Semgrep `1.170.0`, and Renovate owns future upgrades. Repository validation rejects duplicate Snyk or broad Semgrep platform scans.
