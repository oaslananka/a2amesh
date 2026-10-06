## Remediation Complete for ENG-525 (Round 2)

Fixed two categories of issues from the Codacy findings on PR #347:

### 1. Corrected GHSA IDs in `report.md`

The vulnerability identifier `GHSA-238p-pmpm-9mq7` (specific to Hono) was incorrectly duplicated for four packages. Replaced with correct IDs:

| Package | Previous (Incorrect) | Fixed (Correct) |
|---------|---------------------|-----------------|
| `ip-address` 10.7.1 | GHSA-238p-pmpm-9mq7 | **GHSA-mwp4-54f8-5fhr** (Address4 decodes leading-zero octets as decimal) |
| `katex` 0.18.2 | GHSA-238p-pmpm-9mq7 | **No GHSA assigned** (prototype pollution fix in 0.18.2) |
| `markdown-it` 14.3.1 | GHSA-238p-pmpm-9mq7 | **GHSA-253c-mchw-3w2r** (linkify quadratic paths DoS, patched in 14.3.1) |
| `smol-toml` 1.9.0 | GHSA-238p-pmpm-9mq7 | **GHSA-r4xh-jqrq-34v2** (quadratic-time parse, patched in 1.9.0) |

### 2. Aligned `@vue/server-renderer` version in `pnpm-workspace.yaml`

Updated from 3.5.42 to 3.5.43 in both locations per Codacy finding:
- Override: `'@vue/server-renderer@<3.5.43': ^3.5.43`
- Minimum release age exclude: `'@vue/server-renderer@3.5.43'`

### Verification

- ✅ `pnpm install --no-frozen-lockfile` - Lockfile regenerated successfully
- ✅ `pnpm run lint:yaml` - YAML validation passes
- ✅ `pnpm run lint:identity` - Identity checks pass
- ✅ `pnpm run build` - Full build succeeds
- ⚠️ `pnpm run lint:md` - Pre-existing markdownlint errors in `remediation-summary.md` (unrelated to changes)
- ⚠️ `pnpm run typecheck` - Pre-existing type error in `packages/adapters` (missing `@a2amesh/internal-adapter-anthropic` module, unrelated to changes)

Files modified:
- `report.md` - Corrected GHSA IDs
- `pnpm-workspace.yaml` - Updated @vue/server-renderer version
- `pnpm-lock.yaml` - Regenerated lockfile
