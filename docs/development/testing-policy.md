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
- Coverage: regression signal for core behavior.
- Mutation/e2e/performance smoke: higher-cost quality gates.

## Local commands

```bash
pnpm run test:unit
pnpm run test:integration
pnpm run test:coverage
pnpm run test:conformance
```

## CI expectation

All required checks must pass before merge. If a test is flaky, fix or quarantine it with a linked issue; do not silently ignore it.
