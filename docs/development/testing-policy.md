# Testing policy

## Required test expectations

- New user-visible behavior should include tests.
- Bug fixes should include regression tests when practical.
- Protocol and transport changes should include conformance or integration coverage.
- Security-sensitive changes should include negative tests for denied behavior.

## Test categories

- Unit: fast package-level behavior.
- Integration: runtime, transport, registry, and examples smoke paths.
- Conformance: A2A protocol compatibility behavior.
- Coverage: full-package inventory, package floors, and critical-file floors; see [Testing](./testing.md) and [Codecov coverage and test observability](./codecov.md).
- Mutation/e2e/performance smoke: higher-cost quality gates.
- Cassette record/replay: deterministic, LLM-free regression coverage for a recorded task
  lifecycle (`@a2amesh/runtime/testing`'s `CassetteRecorder`/`replayCassette`; see
  [Cassette Record/Replay](../operations/record-replay.md)). Prefer this for regression-testing
  adapter or task-lifecycle changes against a previously recorded "golden" run instead of
  re-invoking a live adapter in the test suite.

## Local commands

```bash
pnpm run test:unit
pnpm run test:integration
pnpm run test:coverage
pnpm run test:conformance
```

## CI expectation

All required checks must pass before merge. If a test is flaky, fix or quarantine it with a linked issue; do not silently ignore it.
