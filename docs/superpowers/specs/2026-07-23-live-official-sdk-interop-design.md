# Live Official SDK Interoperability Design

## Status

Approved through issue #183 and the follow-up instruction to continue implementation.

## Goal

Run maintained official A2A JavaScript and Python SDK code against A2A Mesh clients and servers in four live, version-pinned directions while retaining fixture replay as a separate deterministic regression layer.

## Version contract

- A2A protocol profile: `1.0`
- Node.js: `24.16.0`
- Python: `3.13.14`
- Official JavaScript SDK: `@a2a-js/sdk@1.0.0`
- Official Python SDK: `a2a-sdk==1.1.2`
- A2A Mesh packages: built from the checked-out workspace commit

A reviewed manifest under `tests/interop/live/versions.json` is the single source of truth for these values. CI setup and documentation checks must reject drift from the manifest.

## Architecture

The existing `tests/interop/matrix.json` and `scripts/run-interop-lab.mjs` remain fixture-replay only. Live execution is implemented as a sibling surface under `tests/interop/live/` and is orchestrated by `scripts/run-live-interop.mjs`.

The orchestrator starts only local child processes on loopback interfaces, waits for explicit readiness, runs each scenario, captures bounded JSON diagnostics, and terminates every child process. It never depends on a mutable hosted A2A endpoint.

The four required directions are:

1. Official JavaScript client to A2A Mesh server.
2. A2A Mesh client to official JavaScript server.
3. Official Python client to A2A Mesh server.
4. A2A Mesh client to official Python server.

Each participant is a small executable harness with one responsibility. Official SDK dependencies are installed in isolated subdirectories rather than added to the production workspace dependency graph.

## Scenario allocation

### Official JavaScript client to A2A Mesh server

- Resolve the public Agent Card.
- Observe an HTTP authentication challenge and retry through the official SDK authentication handler.
- Submit a blocking message.
- Retrieve the resulting task.
- Verify the completed state and text artifact.
- Verify protocol version `1.0` was negotiated.

### A2A Mesh client to official JavaScript server

- Resolve the official server Agent Card.
- Submit a streaming message.
- Observe submitted, working, artifact, and completed events.
- Retrieve the final task and verify its artifact.

### Official Python client to A2A Mesh server

- Submit a return-immediately message that creates a cancellable task.
- Retrieve the task.
- Cancel the task.
- Verify the canceled state and protocol version `1.0`.

### A2A Mesh client to official Python server

- Resolve the official server Agent Card.
- Submit a blocking message.
- Verify the completed state and artifact.
- Exercise streaming on a second message and verify the terminal event.

### Negative version scenario

A deliberate `A2A-Version: 9.9` request must fail with a bounded diagnostic containing the unsupported version and a stable error category without including response bodies beyond the configured diagnostic limit.

## Installation and reproducibility

The JavaScript harness has a committed `package.json` and lockfile with exact dependency versions. CI uses `npm ci --ignore-scripts` in that directory.

The Python harness has a committed requirements file with exact top-level versions. CI creates a disposable virtual environment and installs with `pip --disable-pip-version-check`. The Python runtime version is pinned in the workflow and checked against the manifest.

Package installation is the only step that requires registry access. Scenario execution is fully local.

## Diagnostics and redaction

The live runner writes `artifacts/interop-live/report.json` and, on failure, `artifacts/interop-live/diagnostics.json`.

Diagnostics may include participant name, scenario name, command exit code, signal, elapsed time, HTTP status, bounded stderr, and bounded structured error messages. They must not include authorization headers, API keys, cookies, raw request bodies, or unbounded process output. Known credential values are replaced with `[REDACTED]`.

## CI policy

`Interop Lab / official SDK fixtures` remains the fixture-replay job.

Two new live jobs are introduced:

- `Interop Lab / live official JavaScript SDK`
- `Interop Lab / live official Python SDK`

They run on schedule, workflow dispatch, and pull requests touching interop code or its dependencies. They upload distinct report artifacts. Initially they are observational PR checks; issue #149 owns promotion into the required summary after repeated scheduled stability.

## Documentation

`docs/interop/official-sdks.md` must explicitly distinguish fixture replay from live SDK execution. A generated or reviewed table lists runtime, SDK, protocol, scenario directions, and last-known CI guarantee.

The compatibility-doc check validates that documented versions match `tests/interop/live/versions.json`.

## Testing strategy

- Unit tests validate manifest shape, command construction, timeout handling, output bounding, redaction, report generation, and version mismatch diagnostics.
- Focused process integration tests use tiny fixture children to prove readiness, cleanup, and failure artifact behavior.
- Live SDK tests execute the four real directions.
- Existing fixture replay remains unchanged and must continue to pass.

## Non-goals

- Replacing fixture replay.
- Adding gRPC to the initial live lane.
- Testing unreleased SDK branches or mutable GitHub checkouts.
- Making external hosted services part of a required PR check.
- Expanding production runtime APIs solely for the test harness.
