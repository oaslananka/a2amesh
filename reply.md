Successfully updated the vulnerable dependency overrides on PR #346 (fix/eng-422-security-remediation-oaslananka-a2amesh-dependabot-4 branch).

**Changes made:**

- `brace-expansion`: 5.0.9 → 5.0.12
- `markdown-it`: 14.2.0 → 14.3.1
- `smol-toml`: 1.7.1 → 1.9.0

Updated in all three override locations:

- `package.json` (pnpm.overrides)
- `pnpm-workspace.yaml` (overrides)
- `pnpm.yaml` (overrides)

Regenerated `pnpm-lock.yaml` with the new versions.

**Verification results:**

- ✅ `node scripts/check-workspace-declarations.mjs` - passed
- ✅ `node scripts/run-pnpm.mjs install --frozen-lockfile` - passed
- ✅ `pnpm run docs:build` - passed
- ✅ `pnpm run lint` - passed
- ⚠️ `pnpm audit --audit-level high` - 1 high vulnerability remains in `braces@3.0.3` (no patched version available yet, as noted in diagnosis: "Report remaining braces, KaTeX, and UI failures separately")
- ✅ `pnpm run verify` - all stages passed except security (due to braces)

The three targeted vulnerabilities (brace-expansion, markdown-it, smol-toml) have been remediated with verified published fixes.
