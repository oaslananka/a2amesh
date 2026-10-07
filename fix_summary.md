## Fix Summary for ENG-904

### Root Cause

The consumer smoke test script (`scripts/run-consumer-smoke.mjs`) used `execFileSync` with `stdio: 'pipe'` for the monorepo build step (`pnpm run build`). When the build produced large output, the pipe buffer filled up, causing `ENOBUFS` (buffer full) errors.

### Changes Made

#### 1. `scripts/run-consumer-smoke.mjs`

- Added `runStream()` function that uses `stdio: 'inherit'` to stream subprocess output directly to the parent process, avoiding pipe buffer limits
- Added `runPnpmStream()` wrapper for pnpm commands that produce large output
- Updated build step (line 200) to use `runPnpmStream(['run', 'build'], { cwd: root })`
- Updated pack step (line 210) to use `runPnpmStream(['pack', ...], { cwd: pkgDir })`
- Preserved `run()` and `runPnpm()` with `stdio: 'pipe'` for commands where output capture is needed (version checks, help text, etc.)

#### 2. `tests/integration/consumer-binary-smoke-contract.test.ts`

- Added test verifying the script uses `runPnpmStream` and `stdio: 'inherit'` for build/pack
- Added behavioral regression tests:
  - Large output handling (10MB) without ENOBUFS via `runStream`
  - Non-zero exit code propagation from `runStream` (inherit mode)
  - Non-zero exit code propagation from `run` (pipe mode)

### Verification

- ✅ `pnpm exec vitest run --project integration tests/integration/consumer-binary-smoke-contract.test.ts` - 5 tests pass
- ✅ `node scripts/run-consumer-smoke.mjs` - All 10 consumer smoke surfaces pass
- ✅ `npx pnpm run lint:code` - No lint errors
- ✅ Typecheck passes (pre-existing failure in adapters package unrelated to this change)

### CI Impact

The fix addresses the ENOBUFS failure in the consumer-smoke CI matrix without weakening any gates. The four CI consumer-smoke matrix checks (Linux/Windows × Node versions) will now stream build output directly instead of buffering.
