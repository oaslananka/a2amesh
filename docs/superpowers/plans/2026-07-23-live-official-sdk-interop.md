# Live Official SDK Interoperability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible live interoperability lanes that execute pinned official JavaScript and Python A2A SDK clients and servers against A2A Mesh.

**Architecture:** Keep fixture replay unchanged and add a sibling live runner. A Node orchestrator supervises local participant processes, collects bounded JSON results, redacts diagnostics, and writes a live report. Official SDK dependencies live in isolated JavaScript and Python harness directories.

**Tech Stack:** Node.js 24.16.0, pnpm 11.8.0, Vitest, `@a2a-js/sdk@1.0.0`, Express 5.1.0, Python 3.13, `a2a-sdk==1.1.2`, Starlette/Uvicorn.

## Global Constraints

- Protocol profile is exactly `1.0`.
- Official JavaScript SDK is exactly `@a2a-js/sdk@1.0.0`.
- Official Python SDK is exactly `a2a-sdk==1.1.2`.
- Node.js is exactly `24.16.0` in the live CI lane.
- Python is exactly `3.13` in the live CI lane.
- Scenario execution uses loopback-only local processes.
- Fixture replay and live SDK execution retain distinct names, reports, and guarantees.
- Diagnostics redact credentials and bound each captured stream to 16 KiB.

---

### Task 1: Live manifest and validation contract

**Files:**

- Create: `tests/interop/live/versions.json`
- Create: `scripts/live-interop/manifest.mjs`
- Create: `tests/integration/live-interop-manifest.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `loadLiveInteropManifest(root): Promise<LiveInteropManifest>` and `validateLiveInteropManifest(value): string[]`.
- Produces scripts `interop:live:check` and `interop:live`.

- [ ] **Step 1: Write failing manifest tests**

Test exact accepted values, rejection of mutable ranges such as `latest`, rejection of protocol values other than `1.0`, and rejection of missing runtime fields.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm exec vitest run --project integration tests/integration/live-interop-manifest.test.ts`

Expected: failure because `scripts/live-interop/manifest.mjs` does not exist.

- [ ] **Step 3: Add the exact manifest and validator**

The manifest must contain:

```json
{
  "schemaVersion": "2026-07-23",
  "protocolVersion": "1.0",
  "nodeVersion": "24.16.0",
  "pythonVersion": "3.13",
  "javascript": {
    "package": "@a2a-js/sdk",
    "version": "1.0.0"
  },
  "python": {
    "package": "a2a-sdk",
    "version": "1.1.2"
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run the focused integration test and `pnpm run interop:check`.

- [ ] **Step 5: Commit**

Commit message: `test(interop): define live SDK version contract`

### Task 2: Process supervisor, diagnostics, and report model

**Files:**

- Create: `scripts/live-interop/process.mjs`
- Create: `scripts/live-interop/report.mjs`
- Create: `tests/integration/live-interop-process.test.ts`
- Create: `tests/integration/fixtures/live-interop-child.mjs`

**Interfaces:**

- Produces: `startParticipant(options): Promise<ParticipantHandle>` with `waitUntilReady()`, `stop()`, and bounded stdout/stderr access.
- Produces: `redactDiagnostic(value, secrets)` and `writeLiveInteropReport(root, report)`.

- [ ] **Step 1: Write failing supervisor tests**

Cover readiness JSON, startup timeout, non-zero exit, process cleanup, 16 KiB output bounding, and redaction of `Authorization`, `x-api-key`, cookie, and explicit secret values.

- [ ] **Step 2: Verify red state**

Run the focused integration test and confirm imports fail.

- [ ] **Step 3: Implement the minimal supervisor and reporter**

Use `spawn` with `shell: false`, an explicit environment allowlist, loopback URLs, abortable timeout, and cross-platform termination (`SIGTERM`, followed by `SIGKILL` on POSIX; `taskkill` fallback on Windows tests only when required).

- [ ] **Step 4: Verify green state**

Run the focused test twice to catch leaked child processes.

- [ ] **Step 5: Commit**

Commit message: `test(interop): add bounded live process supervisor`

### Task 3: A2A Mesh live participants

**Files:**

- Create: `tests/interop/live/mesh/server.mjs`
- Create: `tests/interop/live/mesh/client.mjs`
- Create: `tests/integration/live-interop-mesh-participants.test.ts`

**Interfaces:**

- Mesh server commands: `serve-complete`, `serve-cancellable`, and `serve-authenticated`.
- Mesh client commands: `blocking`, `streaming`, and `negative-version`.
- Each command emits exactly one JSON result line and no credentials.

- [ ] **Step 1: Write failing participant contract tests**

Start the built workspace runtime, assert readiness, blocking completion with a text artifact, cancellable task behavior, authenticated `401` challenge, stream terminal state, and bounded unsupported-version error.

- [ ] **Step 2: Verify failures before participant files exist**

Run the focused integration test.

- [ ] **Step 3: Implement the minimal Mesh server and client executables**

Import workspace build output, use ephemeral ports, create deterministic text artifacts, use a fixed test API key supplied only through environment, and expose protocol version `1.0` on Agent Cards.

- [ ] **Step 4: Verify participant tests pass**

Run the focused integration test and existing runtime protocol tests.

- [ ] **Step 5: Commit**

Commit message: `test(interop): add live A2A Mesh participants`

### Task 4: Official JavaScript SDK client and server

**Files:**

- Create: `tests/interop/live/javascript/package.json`
- Create: `tests/interop/live/javascript/package-lock.json`
- Create: `tests/interop/live/javascript/client.mjs`
- Create: `tests/interop/live/javascript/server.mjs`
- Create: `tests/integration/live-interop-javascript.test.ts`

**Interfaces:**

- Client command `blocking-auth` uses `ClientFactory`, `JsonRpcTransportFactory`, and `createAuthenticatingFetchWithRetry`.
- Server command `streaming` uses `DefaultRequestHandler`, `InMemoryTaskStore`, `AgentEvent`, `jsonRpcHandler`, and `agentCardHandler`.

- [ ] **Step 1: Write failing JavaScript live tests**

Assert the official client resolves the Mesh card, receives one challenge, retries with the API key, completes a task, retrieves it, and sees an artifact. Assert the Mesh client consumes official SDK submitted/working/artifact/completed stream events and retrieves the final task.

- [ ] **Step 2: Verify failures before harness implementation**

Run the focused integration test after `npm ci --ignore-scripts` in the isolated directory.

- [ ] **Step 3: Implement official JavaScript harnesses**

Use the exact SDK API and emit normalized JSON containing direction, SDK version, protocol version, states, task id, artifact text, authentication challenge count, and elapsed milliseconds.

- [ ] **Step 4: Verify green state**

Run both directions three times sequentially.

- [ ] **Step 5: Commit**

Commit message: `test(interop): execute official JavaScript SDK live`

### Task 5: Official Python SDK client and server

**Files:**

- Create: `tests/interop/live/python/requirements.txt`
- Create: `tests/interop/live/python/client.py`
- Create: `tests/interop/live/python/server.py`
- Create: `tests/integration/live-interop-python.test.ts`

**Interfaces:**

- Client command `cancel` uses `a2a.client.create_client`, a v1.0 `SendMessageRequest`, `GetTaskRequest`, and `CancelTaskRequest`.
- Server command `blocking-streaming` uses `DefaultRequestHandler`, `InMemoryTaskStore`, `AgentExecutor`, Starlette routes, and Uvicorn.

- [ ] **Step 1: Write failing Python live tests**

Assert the official client creates, retrieves, and cancels a Mesh task. Assert the Mesh client completes blocking and streaming interactions against the official Python server and sees artifacts and a terminal state.

- [ ] **Step 2: Verify failures before Python harness implementation**

Create a temporary venv, install `requirements.txt`, and run the focused integration test with `A2A_INTEROP_PYTHON` pointing to that interpreter.

- [ ] **Step 3: Implement official Python harnesses**

Use protobuf message constructors from `a2a.types`, emit one normalized JSON line, and keep Uvicorn logs on stderr so the orchestrator can bound and redact them.

- [ ] **Step 4: Verify green state**

Run both directions three times sequentially.

- [ ] **Step 5: Commit**

Commit message: `test(interop): execute official Python SDK live`

### Task 6: Unified live runner and negative version evidence

**Files:**

- Create: `scripts/run-live-interop.mjs`
- Create: `tests/integration/live-interop-runner.test.ts`
- Modify: `package.json`

**Interfaces:**

- CLI flags: `--check`, `--ecosystem javascript|python|all`, and `--report <path>`.
- Report path defaults to `artifacts/interop-live/report.json`.

- [ ] **Step 1: Write failing runner tests**

Use fixture participant commands to prove ecosystem filtering, four-direction aggregation, negative-version classification, report schema, failure diagnostics, and non-zero exit on any failed scenario.

- [ ] **Step 2: Verify red state**

Run the focused integration test.

- [ ] **Step 3: Implement orchestration**

Build required workspace packages once, run selected scenarios serially to avoid port collisions, always stop participants in `finally`, and write redacted diagnostics on failure.

- [ ] **Step 4: Verify green state and execute real lanes**

Run `pnpm run interop:live -- --ecosystem javascript`, then Python with the venv interpreter, then `all`.

- [ ] **Step 5: Commit**

Commit message: `test(interop): orchestrate live official SDK matrix`

### Task 7: CI jobs, artifacts, and compatibility documentation

**Files:**

- Modify: `.github/workflows/interop-lab.yml`
- Modify: `docs/interop/official-sdks.md`
- Modify: `docs/compatibility.md`
- Modify: `scripts/check-compatibility-docs.mjs`
- Create: `tests/integration/live-interop-docs.test.ts`

**Interfaces:**

- CI job names: `Interop Lab / live official JavaScript SDK` and `Interop Lab / live official Python SDK`.
- Artifact names: `interop-live-javascript-report` and `interop-live-python-report`.

- [ ] **Step 1: Write failing documentation and workflow checks**

Assert fixture and live guarantees are distinct, versions match the manifest, Python setup is exactly 3.13, Node setup is exactly 24.16.0, and each live job uploads its own report plus failure diagnostics.

- [ ] **Step 2: Verify red state**

Run the focused test and `pnpm run docs:check`.

- [ ] **Step 3: Update workflow and docs**

Use pinned action SHAs already approved in the repository, `npm ci --ignore-scripts`, a disposable Python venv, dependency caches keyed by exact lockfiles, and `if: always()` artifact upload with `if-no-files-found: error` for reports.

- [ ] **Step 4: Verify green state**

Run docs checks, YAML lint, actionlint, fixture replay, and both local live lanes.

- [ ] **Step 5: Commit**

Commit message: `ci(interop): add live official SDK lanes`

### Task 8: Full verification and PR completion

**Files:**

- Modify only files required by review findings.

- [ ] **Step 1: Run focused verification**

Run manifest, supervisor, Mesh participant, JavaScript, Python, runner, and docs integration tests.

- [ ] **Step 2: Run repository gates**

Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run docs:check`, `pnpm run verify:structure`, `pnpm run security`, and both fixture/live interop commands.

- [ ] **Step 3: Create and push the PR**

Use a professional public PR body that explicitly distinguishes fixture replay from live execution and closes #183.

- [ ] **Step 4: Inspect all bot and agent feedback**

Review GitHub Advanced Security, CodeQL, SonarQube, Codecov, Semgrep, Socket, DeepScan, Dependency Review, and inline review threads. Address actionable findings and rerun affected checks.

- [ ] **Step 5: Merge only when clean**

Require all relevant checks to pass, all review threads to be resolved, and main post-merge CI to complete successfully.
