# Repository-owned Semgrep implementation plan

1. Add failing contract tests for the pinned custom-rule-only policy.
2. Add `.semgrep.yml` with shell execution, TLS verification, and dynamic evaluation rules.
3. Add a tokenless `Security / semgrep` workflow job.
4. Add the pinned changed-file pre-commit hook.
5. Add local validation scripts and Renovate version extraction.
6. Document why CodeQL, Snyk, SonarQube Cloud, and Trivy keep their existing responsibilities.
7. Run Semgrep, policy tests, actionlint, zizmor, REUSE, pre-commit, and the repository quality gates.
