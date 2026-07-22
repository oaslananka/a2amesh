# Codecov coverage and test observability

A2A Mesh uses Codecov as an informational observability layer for unit coverage, Test Analytics,
and the production JavaScript bundles. Local Vitest thresholds remain the blocking coverage source
of truth, while SonarQube Cloud remains the broader code-quality gate. Codecov statuses are not
required by the repository ruleset, so the same coverage change is not gated twice.

## Repository activation

The repository must be connected to the Codecov GitHub App and keep `CODECOV_TOKEN` configured as a
GitHub Actions repository secret. Upload steps are skipped when the token is unavailable, including
fork pull requests. Upload failures on trusted branches and same-repository pull requests fail the
owning CI job so configuration regressions remain visible.

Validate the repository policy and Codecov YAML locally:

```bash
pnpm run codecov:check
curl --data-binary @codecov.yml https://codecov.io/validate
```

## Coverage and Test Analytics

`CI / unit` runs `pnpm run test:coverage:ci` once. The same Vitest process produces:

- `coverage/lcov.info` for project and patch coverage;
- `test-results/unit.junit.xml` for Codecov Test Analytics and failed-test reporting.

Both uploads use separate invocations of the same immutable `codecov/codecov-action` commit SHA and a pinned Codecov CLI version managed by Renovate. The JUnit invocation explicitly sets `report_type: test_results`, avoiding the deprecated standalone test-results action. Coverage and Test Analytics use the repository `CODECOV_TOKEN` under a token-aware `!cancelled()` guard,
which allows the JUnit report to be uploaded after a test failure without making fork CI depend on a
secret it cannot access. The `unit` flag groups both report types.

Project and patch statuses use automatic targets with a 1% threshold and remain informational.
The blocking source of truth is `coverage-policy.json`, which inventories every active package and
enforces aggregate, package-level, and critical-file floors locally and in `CI / unit`. The same run
publishes machine-readable and Markdown package reports before Codecov uploads begin.

## Bundle Analysis

The repository uses the official bundler-independent analyzer rather than the Codecov Vite plugin,
because the current plugin peer range does not include this repository's Vite major. `CI / unit`
uses the Vite outputs already produced by the coverage run and uploads bundle reports only after the
coverage and Test Analytics uploads have registered the commit. It analyzes only:

- `apps/registry-ui/dist` as `registry-ui`;
- `apps/mission-control/dist` as `mission-control`.

Source maps are excluded. GitHub Actions supplies explicit branch, head SHA, pull-request, build, and
repository metadata, and checkout keeps two commits available as recommended by Codecov. Bundle
uploads authenticate with GitHub OIDC and therefore do not reuse the long-lived coverage token. The
OIDC step is skipped for fork pull requests and is enabled only by `CODECOV_BUNDLE_ANALYSIS=true` in
the Ubuntu unit job. Bundle status is informational with a 5% warning threshold.

A local build can exercise report generation without uploading:

```bash
pnpm run build
pnpm run codecov:bundle:dry-run
```
