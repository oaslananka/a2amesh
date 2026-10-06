## Remediation Complete

Fixed both actionable findings from PR #345:

### 1. CI / required-summary — Workspace declaration validation

**Root cause**: The lockfile contained unreviewed injected workspace resolutions (`file:` protocol with inlined peer dependencies) for many packages, violating the canonical link policy.

**Fix**: Regenerated `pnpm-lock.yaml` with current pnpm@11.8.0. The new lockfile:

- Preserves the two reviewed exceptions using `file:` protocol:
  - `apps/demo|@a2amesh/internal-adapter-anthropic` → `file:packages/adapter-anthropic`
  - `packages/adapters|@a2amesh/internal-adapter-anthropic` → `file:packages/adapter-anthropic`
- All other workspace dependencies now correctly use `link:` protocol
- `pnpm-workspace.yaml` unchanged (keeps `injectWorkspacePackages: true` and `syncInjectedDepsAfterScripts: - build`)

### 2. SonarCloud — `scripts/generate-command-docs.mjs:211` Unexpected `await` inside a loop

**Fix**: Replaced sequential `await format()` calls in the command rendering loop with `Promise.all` for parallel execution. Also optimized the two root page formatting calls to run in parallel.

### Verification

All required gates pass:

- `corepack pnpm install --frozen-lockfile` ✓
- `node scripts/check-workspace-declarations.mjs` ✓
- `node scripts/generate-command-docs.mjs --check` ✓
- `pnpm run lint` ✓
- `pnpm run typecheck` ✓
- `pnpm run test:unit` ✓ (167 test files, 1061 tests passed)

**Files changed**:

- `pnpm-lock.yaml` — 318 lines (workspace resolutions updated to canonical `link:` topology)
- `scripts/generate-command-docs.mjs` — 22 lines (loop awaits → Promise.all)
