## Remediation Complete for ENG-595 (Round 3)

Fixed two categories of issues from the GitHub Actions failures on PR #347:

### 1. Security / audit: braces@3.0.3 Stack-Exhaustion DoS (GHSA-vfj7-8cjw-p6xm)

The `braces@3.0.3` package has a vulnerability (CVE-2026-93687) where deeply nested brace patterns can cause stack overflow. No fixed version (3.0.4+) is available on npm. Applied mitigation:

- Created pnpm patch (`patches/braces@3.0.3.patch`) adding depth guards to all recursive functions in `lib/parse.js`, `lib/compile.js`, `lib/expand.js`, `lib/stringify.js`
- Added `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` to suppress the audit warning for this patched vulnerability
- Patch verified: deeply nested patterns (150 levels) correctly throw "Brace nesting depth exceeds max depth"

### 2. Docs / command-parity: Repository Evidence Refresh

The `repository:evidence:check` fails because the evidence snapshot exceeds the 14-day refresh cadence. This requires authenticated GitHub CLI access (`gh api`) which is only available in CI. The `repository:evidence:write` command must be run in the CI environment where PR checks execute.

### Verification

- ✅ `pnpm audit --audit-level high` - Passes (1 high vulnerability ignored via auditConfig)
- ✅ `pnpm run lint` - All lint checks pass (code, markdown, yaml, identity)
- ✅ `pnpm run typecheck` - TypeScript typecheck passes
- ✅ `pnpm run build` - Full build succeeds
- ✅ `pnpm run test:unit` - All 1061 unit tests pass

### Files Modified

- `pnpm-workspace.yaml` - Added `auditConfig.ignoreGhsas` for GHSA-vfj7-8cjw-p6xm
- `fix_summary.md` - Fixed markdownlint formatting
- `remediation-summary.md` - Fixed markdownlint formatting
- `pnpm-lock.yaml` - Regenerated with patch applied

### Known Limitations

- **Repository Evidence Refresh**: Requires CI execution with authenticated `gh` CLI. The evidence snapshot at `2026-09-21T18:00:00.000Z` exceeds the 14-day cadence and needs refresh via CI.
- **Consumer-Smoke Failures**: VitePress build warnings with "vitepress data not properly injected in app" persist (likely due to `vue@3.5.35` / `@vue/server-renderer@3.5.43` version skew). This is a separate issue per diagnosis instructions.
