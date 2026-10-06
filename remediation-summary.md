## Remediation Summary for ENG-459

### Changes Made

#### 1. Security Fix: braces@3.0.3 Stack-Exhaustion DoS (GHSA-vfj7-8cjw-p6xm)
- **Problem**: `braces@3.0.3` has a vulnerability (CVE-2026-93687) where deeply nested brace patterns can cause stack overflow due to uncontrolled recursion in AST walkers.
- **Solution**: Created a pnpm patch (`patches/braces@3.0.3.patch`) that adds depth guards to all recursive functions:
  - `lib/parse.js`: Added `maxDepth` option (default 100), throws `SyntaxError` when nesting exceeds limit
  - `lib/compile.js`: Added depth tracking to `walk()` function, throws `RangeError` when limit exceeded
  - `lib/expand.js`: Added depth tracking to `walk()` function, throws `RangeError` when limit exceeded
  - `lib/stringify.js`: Added depth tracking to `stringify()` function, throws `RangeError` when limit exceeded
- **Verification**: Tested with deeply nested patterns (150 levels) - correctly throws "Brace nesting depth (101), exceeds max depth (100)"

#### 2. Dependency Synchronization: undici Version
- **Problem**: `packages/runtime/package.json` had `undici: "7.29.0"` but workspace override specifies `7.29.1`
- **Solution**: Updated `packages/runtime/package.json` to `undici: "7.29.1"`
- **Verification**: Lockfile regenerated with consistent `undici@7.29.1` across workspace

#### 3. Lockfile Regeneration
- Ran `pnpm install --no-frozen-lockfile` to incorporate the braces patch and undici version sync
- Lockfile now includes patched braces with hash `b7f86b7235ae5c25237309da1c17621ae0f2d0823f7ac9006f960b20cf884acc`

### Test Results
- ✅ All 473 runtime unit tests pass
- ✅ TypeScript typecheck passes
- ✅ Workspace declaration validation passes
- ✅ Build completes successfully

### Known Limitations
- **Repository Evidence Refresh**: The `repository:evidence:write` command requires authenticated GitHub CLI access (`gh api`), which is not available in this environment. This must be run in the CI environment where the PR checks execute. The evidence snapshot at `2026-09-21T18:00:00.000Z` exceeds the 14-day cadence and needs refresh via CI.
- **Consumer-Smoke Failures**: VitePress build failures with "vitepress data not properly injected in app" persist (likely due to `vue@3.5.35` / `@vue/server-renderer@3.5.43` version skew). This is a separate issue per diagnosis instructions - the renderer security override (`@vue/server-renderer@3.5.42`) is preserved.

### Files Modified
- `pnpm-workspace.yaml` - Added `patchedDependencies` for braces
- `patches/braces@3.0.3.patch` - New patch file with depth guards
- `packages/runtime/package.json` - Updated undici to 7.29.1
- `pnpm-lock.yaml` - Regenerated with patch and version sync
