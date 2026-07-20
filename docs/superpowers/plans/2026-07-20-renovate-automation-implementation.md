# Renovate Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Renovate operational, project-specific, least-privilege, and self-validating for the A2A Mesh monorepo.

**Architecture:** A repository-owned scheduled workflow runs the official Renovate action with `github.token`; repository policy lives in `renovate.json`; a deterministic Node validator and integration test prevent policy drift.

**Tech Stack:** GitHub Actions, Renovate 43.272.4, Node.js ESM, Vitest, pnpm.

## Global Constraints

- Do not update or publish internal `@a2amesh/*` packages.
- Do not enable automerge.
- Keep external actions full-SHA pinned and containers digest pinned.
- Use only existing repository labels.
- Do not mount the Docker socket.
- Use `Europe/Istanbul` scheduling.

---

### Task 1: Define the project-specific config contract

**Files:**

- Create: `tests/integration/renovate-config.test.ts`
- Create: `scripts/check-renovate-config.mjs`

**Interfaces:**

- Produces: `checkRenovateConfig(config, workflow, labels): string[]`

- [ ] Write a failing integration test requiring valid labels, disabled internal packages, no automerge, strict release age, bounded PR counts, and a SHA-pinned least-privilege workflow.
- [ ] Run `corepack pnpm exec vitest run --project integration tests/integration/renovate-config.test.ts` and confirm it fails because the validator/workflow contract is absent.
- [ ] Implement the minimal validator and CLI entry point.
- [ ] Re-run the test and confirm it passes.
- [ ] Commit with `test(deps): define Renovate automation contract`.

### Task 2: Make Renovate operational

**Files:**

- Modify: `renovate.json`
- Create: `.github/renovate-global.json`
- Create: `.github/workflows/renovate.yml`
- Modify: `package.json`

**Interfaces:**

- Consumes: `scripts/check-renovate-config.mjs`
- Produces: `renovate:validate` script and scheduled/manual Renovate workflow.

- [ ] Update the test with exact action SHA, repository allowlist, branch prefix, schedule, lockfile maintenance, and valid label expectations.
- [ ] Run the test and confirm RED against the old configuration.
- [ ] Implement repository/global configuration and workflow.
- [ ] Add `renovate:validate` to run the local contract validator.
- [ ] Run the targeted test and local validator until GREEN.
- [ ] Commit with `ci(deps): run project-specific Renovate automation`.

### Task 3: Document and validate the final setup

**Files:**

- Create: `docs/contributing/dependency-updates.md`
- Modify: `README.md`

- [ ] Document Dashboard triage, major approval, security updates, token behavior, and local validation.
- [ ] Add a concise README link.
- [ ] Run `npx --yes --package=renovate@43.272.4 renovate-config-validator --strict renovate.json`.
- [ ] Run YAML, actionlint, zizmor, formatting, and targeted integration tests.
- [ ] Commit with `docs(deps): document Renovate update policy`.
