# Verification Pipeline Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #151 by making local verification build the workspace once, enabling warm incremental builds, and sharing one deterministic build artifact across build-dependent CI jobs.

**Architecture:** TypeScript package builds remain pnpm-native and use project-reference incremental state on warm runs. A clean build command removes all declared outputs before rebuilding. Local verification is orchestrated by one timed runner that invokes exactly one build and then build-free validation commands. GitHub Actions creates one SHA-scoped workspace build artifact, verifies its manifest after restore, and never shares it across pull requests or workflow runs.

**Tech Stack:** Node.js 24, pnpm 11, TypeScript project references, Vitest, GitHub Actions upload/download artifact actions.

## Global Constraints

- Preserve the complete existing verification contract and required-summary policy.
- A clean checkout must always rebuild successfully without relying on stale incremental state.
- Restored CI artifacts must be scoped to the exact commit and workflow attempt.
- Build outputs and TypeScript incremental metadata must be integrity-checked before use.
- No new task-runner dependency or external build orchestrator may be introduced.

---

### Task 1: Incremental and clean build modes

**Files:**

- Modify: `scripts/build-tsc-package.mjs`
- Create: `scripts/clean-build-outputs.mjs`
- Modify: `package.json`
- Test: `tests/integration/verification-build-cache.test.ts`

**Interfaces:**

- Produces: `pnpm run build` as an incremental build and `pnpm run build:clean` as a deterministic clean build.

- [ ] Write a temporary-package integration test proving a no-change second build preserves emitted output timestamps.
- [ ] Run the test and confirm the current forced build fails it.
- [ ] Make the package helper force compilation only when output is absent or clean/force mode is requested.
- [ ] Add a repository output cleaner and the root `build:clean` command.
- [ ] Prove source changes invalidate incremental output and clean mode rebuilds it.
- [ ] Run the focused integration test and both clean/warm build timings.

### Task 2: Single-build timed local verification

**Files:**

- Create: `scripts/run-verification.mjs`
- Modify: `package.json`
- Modify: `.husky/pre-push`
- Modify: `tests/integration/pre-push-policy.test.ts`
- Test: `tests/integration/verification-pipeline.test.ts`

**Interfaces:**

- Produces: `verify`, `verify:clean`, and `verify:changed` commands plus `.artifacts/verification/timings.json` and `.artifacts/verification/timings.md`.

- [ ] Write a failing script-contract test requiring build-free variants for typecheck, coverage, integration, conformance, schemas, OpenAPI, docs, and performance smoke.
- [ ] Require the verification runner to contain exactly one build stage and to write timing evidence on success or failure.
- [ ] Implement the build-free script variants while retaining existing self-contained commands.
- [ ] Implement the timed verification runner and change pre-push to the named changed-scope command.
- [ ] Run focused tests and verify the timing report schema.

### Task 3: Deterministic CI build artifact reuse

**Files:**

- Create: `scripts/build-artifact-manifest.mjs`
- Create: `.github/actions/restore-workspace-build/action.yml`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/integration/verification-pipeline.test.ts`

**Interfaces:**

- Produces: `.artifacts/build/manifest.json` and the SHA/run-attempt-scoped artifact `workspace-build-${{ github.sha }}-${{ github.run_attempt }}`.

- [ ] Write failing workflow assertions for one clean build, one uploaded artifact, manifest verification, and no build commands in dependent jobs.
- [ ] Implement sorted SHA-256 build manifests with exact-file verification.
- [ ] Add the restore composite action using pinned `actions/download-artifact` and injected-workspace dist synchronization.
- [ ] Upload build outputs and incremental metadata from the build job.
- [ ] Make typecheck, unit, integration, performance, conformance, schemas, mutation, UI E2E, and package dry-run consume the artifact and build-free commands.
- [ ] Run YAML, workflow-policy, manifest, and focused test suites.

### Task 4: Timing budget and reproducibility evidence

**Files:**

- Create: `docs/development/verification-performance.md`
- Modify: `docs/development/testing.md`
- Modify: `docs/development/local-setup.md`
- Modify: `REUSE.toml` if required
- Test: `tests/integration/verification-pipeline.test.ts`

**Interfaces:**

- Documents: clean/warm commands, artifact cache key, invalidation rules, timing report fields, and regression budgets.

- [ ] Write failing documentation assertions for the clean/warm workflow and regression budget.
- [ ] Document baseline, expected warm-build improvement, cache isolation, and reproducibility checks.
- [ ] Run docs parity, markdown lint, REUSE, and generated-evidence checks.

### Task 5: Complete verification and delivery

**Files:**

- Review all changed files.

- [ ] Run clean build, warm build, focused integration tests, lint, typecheck, unit coverage, integration, schemas, docs, security, GC, and workflow checks.
- [ ] Compare clean and warm timing evidence and verify no duplicate full-workspace build remains in `verify` or dependent CI jobs.
- [ ] Run `git diff --check`, inspect the final diff, and commit logical changes.
- [ ] Push through the real pre-push hook, open a PR closing #151, monitor all checks, fix failures, and merge only when required checks and Sonar are green.
