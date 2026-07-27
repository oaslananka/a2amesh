# Testing

Use the narrowest relevant command first, then run `pnpm run verify` before pushing. Unit,
integration, conformance, package, documentation, security, and coverage checks form the local gate.
Clean, warm, and changed-scope behavior is documented in [verification performance](./verification-performance.md).

## Coverage policy

Coverage is enforced by `pnpm run test:coverage`. The canonical inventory and floors live in
`coverage-policy.json`; `vitest.config.ts` consumes that policy rather than maintaining package paths
independently.

The inventory validator fails when an active runtime package is missing, a removed package remains,
a configured root does not exist, a critical file is missing, or an exclusion lacks a reason:

```bash
pnpm run coverage:inventory:check
```

```powershell
pnpm run coverage:inventory:check
```

A coverage run writes:

- `coverage/lcov.info` and `coverage/coverage-summary.json` for standard tooling;
- `coverage/package-summary.json` for automation;
- `coverage/package-summary.md` for local review and the GitHub Actions step summary.

Every active first-party package is measured. Package floors prevent a large package from masking a
regression in a smaller package. Critical protocol and security files have separate branch floors.
Packages touched by the current Git diff are marked in the report and must satisfy the same
repository-owned floor as the full inventory.

## JSON-RPC parser robustness

The HTTP JSON parser remains bounded by `A2AServerOptions.bodyLimit` (`1mb` by default). After JSON
parsing and before schema validation or method dispatch, JSON-RPC requests are also checked with an
iterative object-graph budget:

- maximum nesting depth: `32`;
- maximum entries in any single object or array: `1000`.

Override these defaults only when an agent has a documented protocol need:

```ts
new A2AServer(agentCard, {
  bodyLimit: '512kb',
  jsonRpcInputLimits: {
    maxDepth: 24,
    maxCollectionEntries: 500,
  },
});
```

Limit failures return a deterministic `InvalidRequest` ErrorInfo payload with numeric metadata; they
do not serialize the rejected request. Zod validation failures retain at most eight sanitized issues
and 1024 characters of detail. Raw invalid input values, stack traces, and internal paths are not
included.

The committed malformed-input corpus lives at
`packages/runtime/tests/fixtures/jsonrpc-malformed-corpus.json`. The property-based JSON-RPC test uses
the fixed FastCheck seed `0x0a2a110`, so failures can be reproduced before expanding the corpus with a
minimal regression case.

Run the focused checks with:

```bash
pnpm exec vitest run --project unit \
  packages/runtime/tests/jsonrpc-fuzz.test.ts \
  packages/runtime/tests/jsonrpc-input-limits.test.ts \
  packages/runtime/tests/schema-validator.test.ts
pnpm run test:mutation
```

```powershell
pnpm exec vitest run --project unit `
  packages/runtime/tests/jsonrpc-fuzz.test.ts `
  packages/runtime/tests/jsonrpc-input-limits.test.ts `
  packages/runtime/tests/schema-validator.test.ts
pnpm run test:mutation
```

The required `CI / unit` and `CI / mutation` jobs enforce the corpus, parser budgets, validation
branches, and mutation coverage on pull requests that change the runtime or mutation configuration.

## Commands

Linux, macOS, and PowerShell use the same package scripts:

```bash
pnpm run test:unit
pnpm run test:integration
pnpm run test:conformance
pnpm run test:coverage
pnpm run docs:check
pnpm run security
pnpm run pack:dry-run
pnpm run verify
```

```powershell
pnpm run test:unit
pnpm run test:integration
pnpm run test:conformance
pnpm run test:coverage
pnpm run docs:check
pnpm run security
pnpm run pack:dry-run
pnpm run verify
```

Performance smoke thresholds are enforced with Grafana k6:

```bash
pnpm run perf:smoke
```

```powershell
pnpm run perf:smoke
```

Longer manual load checks use:

```bash
pnpm run perf:load
```

```powershell
pnpm run perf:load
```

The smoke profile starts local A2A server and registry instances, runs bounded threshold checks, and
does not require external services.
