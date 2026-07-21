# Static analysis operations

A2A Mesh assigns one primary tool to each broad responsibility and uses Semgrep only where a repository-owned rule adds distinct value.

## Tool responsibilities

- **CodeQL** is the broad, GitHub-native SAST gate and publishes findings to code scanning.
- **Semgrep** is the required custom-policy gate for the patterns in `.semgrep.yml`.
- **SonarQube Cloud** remains the installed GitHub App for maintainability and quality-gate feedback.
- **Codecov** owns coverage, Test Analytics, and JavaScript bundle observability without replacing local Vitest thresholds.
- **Dependency Review**, **pnpm audit**, and **OSV-Scanner** are the blocking known-vulnerability gates. Socket supplies additional dependency and supply-chain review metadata.
- **Trivy** remains scoped to Dockerfiles, built images, and rendered Helm manifests in the container and Helm workflows.

Snyk was removed after its account and quota limits became an operational dependency. The repository intentionally has no Snyk action, CLI script, secret, or required check. This also avoids making CodeQL, Semgrep, Snyk Code, and Sonar security rules block the same pull request.

## Repository Semgrep policy

The blocking custom rules prohibit:

- shell-capable `exec` and `execSync` APIs;
- `shell: true` child-process execution;
- disabled TLS certificate verification;
- `eval` and `new Function` dynamic evaluation.

Rules are severity `ERROR` and require a targeted test before they are weakened or suppressed. `Security / semgrep` is part of the `main` required-status ruleset.

Run the policy locally with the current pinned Semgrep release:

```bash
python3 -m pip install semgrep==1.170.0
corepack pnpm run security:semgrep
```

`Security / semgrep` installs exactly Semgrep `1.170.0` and runs only `.semgrep.yml`. It does not require a token and therefore behaves the same for trusted and fork pull requests.

## Pre-commit behavior

Install the current framework release and hooks:

```bash
python3 -m pip install pre-commit==4.6.0
pre-commit install
```

The hook configuration pins Gitleaks `v8.30.1` and Semgrep `v1.170.0`. Pre-commit passes changed files to Semgrep, keeping the local check bounded. Full-repository scans remain CI responsibilities.

Unrendered Helm templates are excluded from the generic YAML parser and continue to be validated by the chart-aware Helm workflow.

## Validation

```bash
corepack pnpm run security:tooling:check
corepack pnpm exec vitest run --project integration tests/integration/security-tooling.test.ts
corepack pnpm run security:semgrep
pre-commit run --all-files
```

Workflow changes must also pass actionlint, zizmor, formatting, repository identity checks, and the normal CI suite.
