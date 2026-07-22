# Auditable Release Supersession Recovery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the unpublished `0.11.0-alpha.1` release without publishing a rejected historical candidate, while preserving fail-closed npm publication and allowing Release Please to prepare the verified successor.

**Architecture:** Add a committed `.release-recovery.json` ledger for exceptional release decisions. The release-state collector validates the ledger against Git history and passes the matching entry to the pure evaluator. A new `superseded` state allows only Release Please, never Publish, and is valid only when the superseded version has no canonical tag and no npm publication evidence. The Publish workflow stages the current recovery ledger alongside the guard scripts so an old tag cannot bypass a later supersession decision.

**Tech Stack:** Node.js ESM, TypeScript/Vitest integration tests, GitHub Actions, npm registry observations.

## Global constraints

- Never create or publish `@a2amesh/runtime-v0.11.0-alpha.1` after it is recorded as superseded.
- Supersession is allowed only before any linked package version or canonical tag exists.
- Every entry records the exact historical release commit, successor version, decision date, public tracking issue, and non-sensitive rationale.
- Release Please may proceed from `superseded`; protected Publish must remain blocked.
- The current recovery ledger must be staged before tag checkout in the Publish workflow.
- Observation or validation uncertainty fails closed as `unavailable` or `drifted`.

---

### Task 1: Lock supersession semantics with failing core tests

**Files:**

- Modify: `tests/integration/release-state-core.test.ts`
- Modify: `scripts/release-state-core.d.mts`

- [ ] Add a fixture override for one supersession entry.
- [ ] Assert an unpublished, untagged matching version becomes `superseded` with `{ releasePlease: true, publish: false }`.
- [ ] Assert any canonical tag makes the supersession invalid and blocks both gates.
- [ ] Assert any npm package publication makes the supersession invalid and blocks both gates.
- [ ] Run the focused core test and verify RED.

### Task 2: Implement the pure `superseded` state

**Files:**

- Modify: `scripts/release-state-core.mjs`
- Modify: `scripts/release-state-core.d.mts`
- Test: `tests/integration/release-state-core.test.ts`

- [ ] Normalize an optional supersession observation.
- [ ] Validate that the entry matches the prepared version.
- [ ] Return `superseded` only when tag and npm evidence are absent.
- [ ] Emit actionable blockers when a tagged or partially published version is marked superseded.
- [ ] Permit Release Please only for the valid `superseded` state.
- [ ] Run focused tests and verify GREEN.

### Task 3: Validate and collect the committed recovery ledger

**Files:**

- Create: `.release-recovery.json`
- Modify: `scripts/release-state.mjs`
- Modify: `tests/integration/release-state-cli.test.ts`

- [ ] Add the `0.11.0-alpha.1` entry with release commit `a10452970f9db426f9ef6a407f8be2d69d10eec8`, successor `0.12.0-alpha.1`, issue `#184`, decision date `2026-07-22`, and a public non-sensitive rationale.
- [ ] Add `--recovery-file` CLI support with `.release-recovery.json` as the default.
- [ ] Validate the entry shape, semantic versions, commit existence, candidate manifest version, and ancestry.
- [ ] Pass the current-version entry to the evaluator.
- [ ] Add CLI tests proving Release Please exits zero and Publish exits nonzero for a superseded version.
- [ ] Run CLI tests and verify GREEN.

### Task 4: Prevent historical-tag bypass in Publish

**Files:**

- Modify: `.github/workflows/publish.yml`
- Modify: `scripts/check-release-config.mjs`
- Modify: `tests/integration/release-workflow-guards.test.ts`

- [ ] Stage `.release-recovery.json` with the current guard modules before checking out a tag.
- [ ] Pass the staged ledger through `--recovery-file` to the publish guard.
- [ ] Add static configuration checks for both requirements.
- [ ] Add workflow tests and verify RED then GREEN.

### Task 5: Document normal and exceptional recovery

**Files:**

- Modify: `docs/release/release-integrity.md`
- Modify: `docs/superpowers/specs/2026-07-20-release-integrity-design.md`

- [ ] Add `superseded` to the state table.
- [ ] Document strict eligibility, audit fields, and prohibition on later tagging/publishing.
- [ ] Replace the obsolete instruction to publish `0.11.0-alpha.1` with the recorded supersession decision and successor flow.
- [ ] Document partial publication as ineligible for supersession.

### Task 6: Verify and open the public PR

- [ ] Run focused release-state and workflow-guard integration tests.
- [ ] Run `pnpm run release:dry-run`.
- [ ] Run `pnpm run release:state:release-please` and confirm `superseded` with Release Please allowed.
- [ ] Run `pnpm run release:state:publish -- --tag '@a2amesh/runtime-v0.11.0-alpha.1'` and confirm Publish is blocked.
- [ ] Run lint, typecheck, repository structure checks, secret scan, and dependency audit.
- [ ] Push `fix/release-state-184` and open a public PR referencing #184.
- [ ] Review all bot, agent, static-analysis, and CI comments before merge.
