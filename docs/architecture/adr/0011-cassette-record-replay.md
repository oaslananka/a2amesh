# ADR-0011: Cassette Record/Replay

## Status

Accepted.

## Context

A2A Mesh had no way to capture a task's full lifecycle (creation, messages, artifacts,
state transitions) and later reproduce it without invoking a real adapter. Debugging a
nondeterministic agent run required re-triggering the same prompt against the same live
adapter, which is slow, costly, and not guaranteed to reproduce the original behavior.
`packages/runtime/src/server/TaskManager.ts` already emits a single, well-ordered
`taskUpdated` `EventEmitter` event for every task mutation (`created`, `message`,
`artifact`, `state`, `push-config` — see `TaskUpdatedEvent` in
`packages/runtime/src/server/taskLifecycle.ts`), which is sufficient to reconstruct a
task's entire observable history without touching JSON-RPC transport framing.

No signing/trust-chain helper exists yet in this repository (searched: no `Ed25519`,
`trust-log`, or `packages/runtime/src/security/` code beyond `AgentCardSigner`, which
signs agent cards only). Cassette integrity therefore cannot depend on a signing
primitive that does not exist yet; it needs a self-contained mechanism.

## Decision

### Cassette format

A cassette is a JSONL document: one `CassetteHeader` line, followed by one
`CassetteEntry` line per recorded `taskUpdated` event, in recorded order
(`packages/runtime/src/types/cassette.ts`, schema in
`packages/runtime/src/schemas/public.ts` as `CassetteSchema`, generated to
`cassette.schema.json`). Each entry carries the full redacted `Task` snapshot at that
point (not a diff), the `reason`, an optional `previousState`, a monotonic `sequence`,
and an `integrityHash`.

### Integrity: hash chain, not signatures

`integrityHash[i] = sha256(integrityHash[i-1] + canonicalJson(entry_i without its own hash))`,
seeded from `sha256(canonicalJson(header))`. `canonicalJsonStringify`
(`packages/runtime/src/testing/cassette/canonicalJson.ts`) recursively sorts object keys
so the hash does not depend on property insertion order. This detects any mutation to any
recorded entry or the header — tampering with entry `i` breaks every hash from `i`
onward — without depending on a signing key or trust log. Signing a cassette (e.g. once a
future trust-chain feature exists) can wrap this hash chain rather than replace it.

### `CassetteRecorder`: opt-in, zero-cost when unused

`CassetteRecorder.attach(taskManager)` subscribes an ordinary `EventEmitter` listener to
`taskManager`'s `taskUpdated` event. Nothing records unless a caller explicitly attaches a
recorder — there is no server-level flag that forces recording, matching this
repository's default-off cost model for optional infrastructure (see `A2AServerOptions`
in `packages/runtime/src/server/A2AServer.ts`, all of whose extras are opt-in).

### Redaction: default-on, content-only

`redactTask` (`packages/runtime/src/testing/cassette/redaction.ts`) walks message and
artifact parts (and artifact metadata) for secret-shaped substrings — bearer tokens,
`sk-`-style API keys, PEM private key blocks, environment-style secret assignments (API-key or access-token strings) —
and replaces matches with `[REDACTED]`. It is reimplemented locally rather than imported
from `@a2amesh/internal-fleet`'s similar artifact-credential heuristic, so
`packages/runtime` does not take a new dependency on a package above it in the dependency
direction. Redaction defaults to on (`CassetteRecorderOptions.redact ?? true`) and is
recorded in the header (`CassetteHeader.redacted`) so a replay can reconstruct a
compatible recorder. Task identifiers, status, and timestamps are never redacted — only
user/agent-authored content can carry secret-shaped values.

### `ReplayEngine`: LLM-free, against a fresh `TaskManager`

`replayCassette` drives a **fresh, isolated `TaskManager`** (not a full `A2AServer`/HTTP
stack) through the recorded `created → message → artifact(s) → state(s)` sequence,
re-invoking the same `TaskManager` methods (`createTask`, `addHistoryMessage`,
`addArtifact`, `updateTaskState`) that originally produced each entry. By default,
artifacts are served from the cassette itself (fully adapter-free); a caller may instead
pass `handleTask(task, message)` to replay the recorded prompt against a **different**
adapter implementation and detect divergence — the regression-testing use case. A bare
`TaskManager` is sufficient because it is the single source of truth for the observable
task lifecycle; standing up Express/HTTP for replay would add cost without adding
signal. `push-config` entries are out of scope for replay (no push endpoint exists in the
replay harness); this is a known limitation, not an oversight.

### Determinism guarantees and their limits

Replay guarantees **structural equality** of the `taskUpdated` sequence: the same
`reason` order, the same `TaskState` sequence, and the same message/artifact content
(`findFirstStructuralMismatch` in `ReplayEngine.ts`). It does **not** guarantee identical
wall-clock timestamps or derived timing metadata (`startedAt`, `endedAt`, `durationMs`),
or an identical generated task id — `taskLifecycle.ts`'s `createSubmittedTask`/
`applyTaskStateToTask` read `new Date().toISOString()` directly with no injectable clock,
and `TaskManager.createTask` always generates a fresh `randomUUID()`. Adding a clock
seam to those functions would touch every caller for a cosmetic guarantee replay does not
need; the comparison excludes clock-derived fields and the task id instead. A cassette's
own `integrityHash` chain is exact and unaffected by this: it hashes the entries as
recorded, not as replayed.

## Consequences

Recording is opt-in and cheap (one `EventEmitter` subscription); nothing pays for it
unless a cassette is requested. Replay runs LLM-free and fully offline, making
regression tests fast and deterministic. Tampering with a recorded cassette is always
detected before replay proceeds. The known gaps — no raw JSON-RPC/SSE frame capture, no
`push-config` replay, no flight-recorder ring buffer, no `a2amesh dump` endpoint — are
deferred rather than half-built; `TaskManager`'s `taskUpdated` stream already captures
every semantically meaningful state change a task goes through, which is what record/replay
needs to be useful today.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
pnpm --filter @a2amesh/runtime run test
pnpm run test:integration
```

Relevant coverage:

- [`CassetteRecorder tests`](../../../packages/runtime/tests/CassetteRecorder.test.ts)
- [`ReplayEngine tests`](../../../packages/runtime/tests/ReplayEngine.test.ts)
- [`cassette record/replay integration test`](../../../tests/integration/cassette-replay.test.ts)
