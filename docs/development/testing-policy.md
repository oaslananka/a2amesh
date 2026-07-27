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

## Mutation testing policy

Run the bounded mutation suite with:

```bash
pnpm run test:mutation
```

The canonical targets, test files, and thresholds live in `stryker.config.json`. Mutation-relevant
pull requests run the `CI / mutation` lane after the shared workspace build has been restored. The
quality bands are `high: 95`, `low: 90`, and `break: 85`; a score below 85 fails the command and CI.

The 2026-07-27 hardening baseline is 100% across the configured mutation surface after excluding
two verified equivalent mutants in `packages/runtime/src/types/jsonrpc.ts`. Both exclusions are
source-local `Stryker disable next-line` directives with reasons:

- assigning `undefined` to the emitted optional `JsonRpcError.data` class field is observationally
  identical to leaving its initialized value unchanged;
- bypassing the `typeof value === 'object'` check for a truthy primitive still fails the exact
  `@type` comparison after JavaScript property-access boxing, while nullish values short-circuit.

Equivalent-mutant exclusions must remain narrow, name the mutator, include a concrete semantic
reason, and be reviewed with the same scrutiny as production changes. Broad file-level mutation
disables are not permitted. New critical protocol validation or authorization branches must not be
left as `NoCoverage`.

## Local commands

```bash
pnpm run test:unit
pnpm run test:integration
pnpm run test:coverage
pnpm run test:conformance
```

## CI expectation

All required checks must pass before merge. If a test is flaky, fix or quarantine it with a linked issue; do not silently ignore it.
