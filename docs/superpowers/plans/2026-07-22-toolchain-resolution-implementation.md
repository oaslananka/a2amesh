# Deterministic Toolchain Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Node.js and pnpm resolution deterministic across mise, Corepack, direct shell commands, Node child processes, Git hooks, and the cross-platform CI compatibility matrix.

**Architecture:** `mise.toml` owns the exact default Node.js version and enables Corepack shims. The root `packageManager` field remains the single owner of the exact pnpm version. A repository doctor command independently inspects direct pnpm, Corepack pnpm, and child-process pnpm resolution, while bootstrap and Git-hook entry points use explicit `corepack pnpm` so they remain usable when an external shim is misconfigured.

**Tech Stack:** Node.js 24.16.0, Node.js compatibility 22.22.3/24.16.0, Corepack, pnpm 11.8.0, mise, TypeScript, Vitest, GitHub Actions.

## Global Constraints

- Keep `tools/runtime-versions.json` as the canonical version manifest.
- Keep `packageManager` pinned to `pnpm@11.8.0`; do not add pnpm as an independent mise tool.
- Pin the default mise Node.js tool to `24.16.0` and enable `node.corepack`.
- Preserve the existing Node.js compatibility matrix entries `22.22.3` and `24.16.0`.
- Support Linux, macOS, and Windows without shell-specific package-manager assumptions.
- Do not address package binary linking tracked by #147 or CI build duplication tracked by #151.
- Every public bootstrap command must have PowerShell parity.

---

### Task 1: Specify the deterministic toolchain contract

**Files:**

- Modify: `tests/integration/runtime-versions-script.test.ts`
- Create: `tests/integration/toolchain-check.test.ts`

**Interfaces:**

- Consumes: `tools/runtime-versions.json`, the root `packageManager`, compatibility-matrix fixtures.
- Produces: expected `mise.toml`, setup script, hook commands, CI doctor command, and `validateToolchainDiagnostics()` behavior.

- [ ] Add fixture assertions that write mode creates the exact mise/Corepack contract and explicit Corepack hook commands.
- [ ] Add pure doctor validation tests for matching diagnostics, version drift, command failures, and direct/child executable mismatch.
- [ ] Run the focused tests and confirm they fail before implementation.

### Task 2: Add the toolchain doctor

**Files:**

- Create: `scripts/check-toolchain.mjs`
- Create: `scripts/check-toolchain.d.mts`
- Modify: `knip.json`
- Modify: `REUSE.toml`

**Interfaces:**

- Consumes: `tools/runtime-versions.json`, `package.json`, `PATH`, `process.execPath`.
- Produces: `validateToolchainDiagnostics(input): string[]` and the `pnpm run toolchain:check` CLI contract.

- [ ] Resolve direct `pnpm` and `corepack` to absolute paths before execution.
- [ ] Spawn a fresh Node.js child that independently resolves pnpm and returns JSON diagnostics.
- [ ] Validate Node compatibility, exact package-manager metadata, exact pnpm parity, and direct/child executable identity.
- [ ] Print actionable mise, Corepack, and automation remediation when validation fails.
- [ ] Run focused doctor tests until green.

### Task 3: Make repository entry points Corepack-safe

**Files:**

- Modify: `package.json`
- Modify: `.husky/pre-commit`
- Modify: `.husky/pre-push`
- Create: `scripts/run-pnpm.mjs`
- Create: `scripts/run-pnpm.d.mts`
- Create: `scripts/toolchain-command.mjs`
- Modify: `scripts/check-utils.mjs`
- Modify: `tests/integration/check-utils.test.ts`

**Interfaces:**

- Consumes: `npm_execpath` when already running under pnpm.
- Produces: a repository launcher that prepends an ephemeral Corepack-backed pnpm shim, a deterministic `runPnpmSync()` fallback, and hooks that do not depend on a stale mise pnpm shim.

- [ ] Add a failing command-runner test proving fallback arguments are routed through Corepack.
- [ ] Preserve the existing `npm_execpath` fast path.
- [ ] Change bootstrap and hooks to explicit `corepack pnpm` commands.
- [ ] Run command-runner and hook contract tests until green.

### Task 4: Govern configuration drift and cross-platform CI

**Files:**

- Create: `mise.toml`
- Modify: `scripts/check-runtime-versions.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/actions/setup-pnpm/action.yml`
- Modify: `tests/integration/runtime-versions-script.test.ts`

**Interfaces:**

- Consumes: runtime manifest values.
- Produces: synchronized mise config, package scripts, hook commands, and compatibility-matrix toolchain verification.

- [ ] Synchronize `mise.toml`, `setup`, `toolchain:check`, and both Git hooks from the runtime manifest.
- [ ] Require every compatibility-matrix runner to execute the doctor.
- [ ] Verify direct and Corepack pnpm versions in the composite setup action before installation.
- [ ] Run runtime-version fixtures, actionlint, and YAML validation.

### Task 5: Document clean-shell bootstrap and remediation

**Files:**

- Modify: `CONTRIBUTING.md`
- Modify: `docs/development/setup.md`
- Modify: `docs/development/local-setup.md`

**Interfaces:**

- Consumes: the implemented mise/Corepack ownership model.
- Produces: Linux/macOS and PowerShell instructions for mise users, non-mise users, and immutable automation hosts.

- [ ] Document `mise install`, `mise reshim`, `corepack enable`, explicit `corepack pnpm install`, and `corepack pnpm run toolchain:check`.
- [ ] Explain that mise owns Node.js while `packageManager` plus Corepack owns pnpm.
- [ ] Run Markdown and PowerShell parity validation.

### Task 6: Verify, publish, and review

**Files:**

- Modify only files required by validation findings.

**Interfaces:**

- Consumes: completed branch implementation.
- Produces: an exact validated commit, PR closing #162, and a clean bot/agent review state.

- [ ] Run focused integration tests, runtime/toolchain checks, docs checks, REUSE, Knip, actionlint, and exact full pre-push verification.
- [ ] Push `fix/toolchain-resolution-162` and open a PR with `Closes #162`.
- [ ] Inspect all GitHub checks, issue comments, reviews, inline comments, SonarQube findings, and other bot/agent suggestions.
- [ ] Resolve every substantive finding and rerun exact validation.
- [ ] Squash merge only when all required checks are green and no review finding remains unresolved.
