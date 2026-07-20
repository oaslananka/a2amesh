# Release Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic release-state machine that blocks new Release Please preparation until the current linked source version is fully reconciled across Git and npm, while preserving protected manual publication.

**Architecture:** A pure evaluator in `scripts/release-state-core.mjs` owns state classification and dist-tag policy. `scripts/release-state.mjs` only collects GitHub, Git, manifest, and npm observations, then applies mode-specific exit behavior. Workflows call explicit `release-please` and `publish` modes, while static tests prevent policy drift.

**Tech Stack:** Node.js ESM, TypeScript/Vitest integration tests, GitHub Actions YAML, GitHub CLI, npm registry CLI, pnpm 11.7.0.

## Global Constraints

- The release manifest and linked public package manifests are the prepared source-version authority.
- The canonical release tag is `@a2amesh/runtime-v<version>` and must resolve to the checked-out commit.
- Prereleases may advance only their first prerelease identifier (`alpha`, `beta`, or `rc`); they must never advance `latest`.
- Stable releases use `latest`.
- GitHub/npm observation failures classify as `unavailable`, never success.
- Release Please is allowed only for `published` and `release-pr-open`.
- Publish is allowed only when source versions agree, the canonical tag matches HEAD, and existing npm evidence is absent or resumable for the same version.
- Keep the protected manually dispatched `npm-publish` environment and OIDC Trusted Publishing model.
- Do not introduce a new runtime dependency or release framework.

---

## File Structure

- Create `scripts/release-state-core.mjs`: pure version policy and state evaluator; no subprocesses or filesystem access.
- Modify `scripts/release-state.mjs`: observation collection, CLI modes, deterministic JSON/human output, exit codes.
- Modify `scripts/sync-npm-tags.mjs`: consume shared dist-tag policy and stop treating `latest` as required for prereleases.
- Modify `.github/workflows/release-please.yml`: run the release-state gate before Release Please.
- Modify `.github/workflows/publish.yml`: check out the requested tag and run publish-mode state validation.
- Modify `scripts/check-release-config.mjs`: statically enforce both workflow gates and dist-tag policy wiring.
- Modify `package.json`: add explicit release-state convenience scripts.
- Create `tests/integration/release-state-core.test.ts`: deterministic state and policy tests.
- Create `tests/integration/release-state-cli.test.ts`: subprocess-backed fixture tests with fake `gh`, `git`, and `npm` executables.
- Create `tests/integration/release-workflow-guards.test.ts`: static workflow and release-config policy tests.
- Create `docs/release/release-integrity.md`: maintainer flow, incident states, recovery commands.

### Task 1: Pure release-state evaluator

**Files:**
- Create: `scripts/release-state-core.mjs`
- Create: `tests/integration/release-state-core.test.ts`

**Interfaces:**
- Produces: `expectedDistTag(version: string): string`
- Produces: `evaluateReleaseState(observation: ReleaseObservation): ReleaseEvaluation`
- `ReleaseObservation` contains `repository`, `checkedOutCommit`, `sourcePackages`, `canonicalTag`, `releasePrs`, `npmPackages`, and `errors`.
- `ReleaseEvaluation` contains `state`, `version`, `expectedTag`, `expectedDistTag`, `blockers`, `warnings`, `gates`, `packages`, and `nextSafeAction`.

- [ ] **Step 1: Write failing evaluator tests**

Cover these independent cases in `tests/integration/release-state-core.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluateReleaseState, expectedDistTag } from '../../scripts/release-state-core.mjs';

it('uses alpha rather than latest for an alpha prerelease', () => {
  expect(expectedDistTag('0.11.0-alpha.1')).toBe('alpha');
});

it('classifies a fully published alpha with an older stable latest as published', () => {
  const result = evaluateReleaseState(publishedAlphaObservation());
  expect(result.state).toBe('published');
  expect(result.gates).toEqual({ releasePlease: true, publish: false });
});

it('classifies a newer open linked release PR as release-pr-open', () => {
  const result = evaluateReleaseState({
    ...publishedAlphaObservation(),
    releasePrs: [{ number: 156, url: 'https://example.test/156', versions: ['0.12.0-alpha.1'] }],
  });
  expect(result.state).toBe('release-pr-open');
  expect(result.gates.releasePlease).toBe(true);
});

it('allows protected publication when a newer release PR is open', () => {
  const observation = preparedObservation({ tagCommit: 'abc123', openVersion: '0.12.0-alpha.1' });
  const result = evaluateReleaseState(observation);
  expect(result.state).toBe('prepared-unpublished');
  expect(result.gates.publish).toBe(true);
});
```

Also cover stable publication, missing tag/npm versions, tag-only preparation, partial package publication, prerelease incorrectly assigned to `latest`, canonical tag on another commit, multiple release PRs, inconsistent PR versions, and observation errors.

- [ ] **Step 2: Run the evaluator test and verify RED**

Run:

```bash
corepack pnpm exec vitest run --project integration tests/integration/release-state-core.test.ts
```

Expected: FAIL because `scripts/release-state-core.mjs` does not exist.

- [ ] **Step 3: Implement the minimal pure evaluator**

Implement:

```js
export function expectedDistTag(version) {
  const marker = version.indexOf('-');
  return marker === -1 ? 'latest' : version.slice(marker + 1).split('.')[0];
}

export function evaluateReleaseState(observation) {
  // Validate one linked source version.
  // Reject observation errors, conflicting tags, invalid PRs, and latest-on-prerelease drift.
  // Count exact npm versions and expected dist-tags.
  // Return mutually exclusive state and mode gates.
}
```

State precedence must be `unavailable` → `drifted` → `published/release-pr-open` → `partial-publication` → `prepared-unpublished`.

- [ ] **Step 4: Run the evaluator test and verify GREEN**

Run the same Vitest command. Expected: all evaluator tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-state-core.mjs tests/integration/release-state-core.test.ts
git commit -m "feat(release): model cross-system release state"
```

### Task 2: Observation collector and mode-aware CLI

**Files:**
- Modify: `scripts/release-state.mjs`
- Create: `tests/integration/release-state-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `evaluateReleaseState()` and `expectedDistTag()` from Task 1.
- Produces CLI modes: `--mode report`, `--mode release-please`, `--mode publish`.
- Produces optional `--tag @a2amesh/runtime-v<semver>` validation.
- Produces `--json` deterministic JSON output.

- [ ] **Step 1: Write failing CLI fixture tests**

Create temporary fixture workspaces and prepend fake executable scripts to `PATH` so the real collector runs without network access. The fake commands must model:

```ts
it('blocks release-please mode when the prepared version is unpublished', async () => {
  const result = await runReleaseStateFixture({ mode: 'release-please', npmVersions: [] });
  expect(result.exitCode).toBe(1);
  expect(result.json.state).toBe('prepared-unpublished');
});

it('permits publish mode with a matching tag and a newer open release PR', async () => {
  const result = await runReleaseStateFixture({
    mode: 'publish',
    tagCommit: 'abc123',
    openReleaseVersion: '0.12.0-alpha.1',
  });
  expect(result.exitCode).toBe(0);
  expect(result.json.gates.publish).toBe(true);
});

it('returns unavailable when npm cannot be observed', async () => {
  const result = await runReleaseStateFixture({ npmFailure: 'ETIMEDOUT' });
  expect(result.exitCode).toBe(0);
  expect(result.json.state).toBe('unavailable');
});
```

- [ ] **Step 2: Run the CLI test and verify RED**

```bash
corepack pnpm exec vitest run --project integration tests/integration/release-state-cli.test.ts
```

Expected: FAIL because the existing collector does not support explicit modes, npm observations, PR manifest inspection, or injectable fake command behavior.

- [ ] **Step 3: Refactor `release-state.mjs` into observation-only responsibilities**

Implement argument parsing and adapters:

```js
const options = parseArgs(process.argv.slice(2));
const observation = collectReleaseObservation(options);
const evaluation = evaluateReleaseState(observation);
printEvaluation(evaluation, { json: options.json });

if (options.mode === 'release-please' && !evaluation.gates.releasePlease) process.exitCode = 1;
if (options.mode === 'publish' && !evaluation.gates.publish) process.exitCode = 1;
```

The collector must:

- read and compare configured package versions;
- resolve `HEAD` and the canonical runtime tag;
- list open `release-please--branches--main` PRs and read each branch manifest through `gh api`;
- query exact npm-version existence and package dist-tags;
- convert command failures other than npm E404 into `errors`;
- keep `--check` as a backward-compatible alias for `--mode publish`.

Add scripts:

```json
"release:state": "node scripts/release-state.mjs --mode report",
"release:state:release-please": "node scripts/release-state.mjs --mode release-please --json",
"release:state:publish": "node scripts/release-state.mjs --mode publish --json"
```

- [ ] **Step 4: Run CLI and evaluator tests**

```bash
corepack pnpm exec vitest run --project integration tests/integration/release-state-core.test.ts tests/integration/release-state-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-state.mjs package.json tests/integration/release-state-cli.test.ts
git commit -m "feat(release): collect and gate release observations"
```

### Task 3: Correct prerelease dist-tag synchronization

**Files:**
- Modify: `scripts/sync-npm-tags.mjs`
- Modify: `tests/integration/release-state-core.test.ts`

**Interfaces:**
- Consumes: `expectedDistTag(version)` from Task 1.
- Stable policy: require/write `latest`.
- Prerelease policy: require/write only the prerelease identifier and reject `latest === version`.

- [ ] **Step 1: Add the failing policy regression test**

```ts
it('never requires latest to move to a prerelease', () => {
  const result = evaluateReleaseState(publishedAlphaObservation({ latest: '0.1.0-alpha.1' }));
  expect(result.blockers).not.toContain(expect.stringContaining('expected latest'));
});

it('rejects latest when it points to the prepared prerelease', () => {
  const result = evaluateReleaseState(publishedAlphaObservation({ latest: '0.11.0-alpha.1' }));
  expect(result.state).toBe('drifted');
});
```

- [ ] **Step 2: Run tests and verify the new regression fails if policy is incomplete**

Run the Task 1 test command. Expected: the latest-on-prerelease case fails until policy enforcement is complete.

- [ ] **Step 3: Update the synchronization script**

Replace the unconditional `latest` label set with:

```js
import { expectedDistTag } from './release-state-core.mjs';

const expectedTag = expectedDistTag(version);
if (tags[expectedTag] !== version) {
  // validate or write only expectedTag
}
if (expectedTag !== 'latest' && tags.latest === version) {
  failures.push(`${packageJson.name}: latest must not point to prerelease ${version}`);
}
```

`--write` must not change `latest` for a prerelease.

- [ ] **Step 4: Run evaluator tests and release-config check**

```bash
corepack pnpm exec vitest run --project integration tests/integration/release-state-core.test.ts
node scripts/check-release-config.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-npm-tags.mjs tests/integration/release-state-core.test.ts
git commit -m "fix(release): preserve latest for prerelease publication"
```

### Task 4: Enforce workflow gates and tag checkout

**Files:**
- Modify: `.github/workflows/release-please.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `scripts/check-release-config.mjs`
- Create: `tests/integration/release-workflow-guards.test.ts`

**Interfaces:**
- Release Please invokes `node scripts/release-state.mjs --mode release-please --json` before `release-please-action`.
- Publish checks out `${{ steps.tag.outputs.tag }}` and invokes `node scripts/release-state.mjs --mode publish --json --tag "${TAG}"`.

- [ ] **Step 1: Write failing workflow static tests**

```ts
it('gates Release Please before creating or updating a release PR', async () => {
  const workflow = await readFile('.github/workflows/release-please.yml', 'utf8');
  expect(workflow.indexOf('--mode release-please')).toBeLessThan(
    workflow.indexOf('googleapis/release-please-action'),
  );
});

it('publishes from the requested canonical tag and uses publish mode', async () => {
  const workflow = await readFile('.github/workflows/publish.yml', 'utf8');
  expect(workflow).toContain('ref: ${{ steps.tag.outputs.tag }}');
  expect(workflow).toContain('--mode publish');
});
```

- [ ] **Step 2: Run the static test and verify RED**

```bash
corepack pnpm exec vitest run --project integration tests/integration/release-workflow-guards.test.ts
```

Expected: FAIL because the workflow gates and tag checkout are absent.

- [ ] **Step 3: Update workflows and static release validation**

Add the Release Please gate after config validation and before the action. In Publish, change checkout to the requested tag, then pass the tag to publish mode. Update `check-release-config.mjs` to require exact mode invocations and tag checkout, and to reject the old bare `release-state.mjs --check` wiring.

- [ ] **Step 4: Run workflow and release checks**

```bash
corepack pnpm exec vitest run --project integration tests/integration/release-workflow-guards.test.ts
node scripts/check-release-config.mjs
node scripts/check-yaml.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-please.yml .github/workflows/publish.yml scripts/check-release-config.mjs tests/integration/release-workflow-guards.test.ts
git commit -m "ci(release): block unreconciled release preparation"
```

### Task 5: Maintainer documentation and full verification

**Files:**
- Create: `docs/release/release-integrity.md`
- Modify: `docs/README.md` or the existing release-document index that links maintainer release documents.

**Interfaces:**
- Documents state meanings, safe commands, tag creation, publish dispatch, partial-publication recovery, and PR #156 recovery decision.

- [ ] **Step 1: Write the maintainer guide**

Include exact commands:

```bash
corepack pnpm run release:state
corepack pnpm run release:state:release-please
git tag '@a2amesh/runtime-v0.11.0-alpha.1' <verified-release-commit>
git push origin '@a2amesh/runtime-v0.11.0-alpha.1'
gh workflow run Publish --ref '@a2amesh/runtime-v0.11.0-alpha.1' \
  -f tag='@a2amesh/runtime-v0.11.0-alpha.1' \
  -f confirmation='PUBLISH @a2amesh/runtime-v0.11.0-alpha.1'
```

State clearly that the tag and publish commands are maintainer actions, not automated by the checker.

- [ ] **Step 2: Run documentation and targeted integration checks**

```bash
node scripts/check-public-docs-links.mjs
node scripts/check-release-config.mjs
corepack pnpm exec vitest run --project integration \
  tests/integration/release-state-core.test.ts \
  tests/integration/release-state-cli.test.ts \
  tests/integration/release-workflow-guards.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run repository verification relevant to the change**

```bash
node scripts/check-package-names.mjs
node scripts/check-identity.mjs
node scripts/check-forbidden-refs.mjs
node scripts/check-no-generated-artifacts.mjs
node scripts/check-no-secrets.mjs
node scripts/check-runtime-versions.mjs
node scripts/check-labels.mjs
node scripts/check-yaml.mjs
node scripts/check-release-config.mjs
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Generate live recovery evidence without mutation**

```bash
corepack pnpm run release:state -- --json
```

Expected on the current repository: `prepared-unpublished` or `partial-publication`, with `0.11.0-alpha.1`, the exact canonical tag, missing npm versions/dist-tags, and a safe next action. It must not report `published`.

- [ ] **Step 5: Commit**

```bash
git add docs/release/release-integrity.md docs/README.md
git commit -m "docs(release): document integrity recovery workflow"
```

- [ ] **Step 6: Final branch verification**

```bash
git status --short
git log --oneline --decorate -6
git diff --check docs/release-integrity-144-design...HEAD
```

Expected: clean status and no whitespace errors.
