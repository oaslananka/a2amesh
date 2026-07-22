# Repository-owned Semgrep implementation plan

1. Add failing contract tests for the pinned custom-rule-only policy.
2. Add `.semgrep.yml` with shell execution, TLS verification, and dynamic evaluation rules.
3. Add a tokenless, required `Security / semgrep` workflow job.
4. Add the pinned changed-file pre-commit hook and align Gitleaks with CI.
5. Add local validation scripts and Renovate version extraction.
6. Document the division of responsibility across CodeQL, Semgrep, SonarQube Cloud, Codecov, dependency scanners, and Trivy, including the decision not to restore Snyk.
7. Run Semgrep, policy tests, actionlint, zizmor, REUSE, pre-commit, and the repository quality gates.
