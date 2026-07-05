# Cassette Record/Replay

A2A Mesh can record a task's full lifecycle to a "cassette" — an ordered, integrity-hash-chained JSONL file — and later replay it without invoking a real adapter. This turns a previously observed task run into a deterministic, LLM-free regression test: no live LLM call, no network dependency, no flaky timing.

See [ADR-0011](../architecture/adr/0011-cassette-record-replay.md) for the design rationale and determinism limits.

## Shipped assets

| Asset                                                                     | Purpose                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CassetteRecorder` (`@a2amesh/runtime/testing`)                           | Subscribes to a `TaskManager`'s `taskUpdated` events and builds a cassette.          |
| `replayCassette` / `verifyCassetteIntegrity` (`@a2amesh/runtime/testing`) | Verifies integrity and replays a cassette's lifecycle against a fresh `TaskManager`. |
| `serializeCassetteToJsonl` / `parseCassetteFromJsonl`                     | JSONL (de)serialization for cassette files.                                          |
| `a2amesh replay <cassette>` CLI command                                   | Verifies and replays a cassette file from the terminal or CI.                        |
| `cassette.schema.json`                                                    | Generated JSON Schema for the cassette document (`packages/protocol/schemas/`).      |

## Recording a cassette

Attach a `CassetteRecorder` to any `A2AServer` subclass's `TaskManager`. Recording is opt-in: nothing is recorded unless a recorder is attached.

```typescript
import { CassetteRecorder, serializeCassetteToJsonl } from '@a2amesh/runtime/testing';
import { writeFileSync } from 'node:fs';

const recorder = new CassetteRecorder(); // redact: true by default
const unsubscribe = recorder.attach(server.getTaskManager());

// ... drive the task to completion (send a message, wait for COMPLETED/FAILED) ...

unsubscribe();
writeFileSync('task.cassette.jsonl', serializeCassetteToJsonl(recorder.toCassette()));
```

Secret-shaped content (bearer tokens, `sk-`-style API keys, PEM private key blocks, environment-style secret assignments (API-key or access-token strings)) is redacted from recorded message and artifact content by default; pass `{ redact: false }` only for local debugging of a cassette you will not share.

## Replaying a cassette

```bash
a2amesh replay ./task.cassette.jsonl
a2amesh replay ./task.cassette.jsonl --step
a2amesh replay ./task.cassette.jsonl --json
```

`replayCassette` first verifies the cassette's integrity hash chain, then drives a fresh, isolated `TaskManager` through the recorded `created → message → artifact(s) → state(s)` sequence, serving artifacts from the cassette (no adapter call) unless a `handleTask` override is supplied. The CLI and library both report:

- `integrityValid` — false if any recorded entry was tampered with.
- `matches` — false if the replayed sequence structurally diverges from the recording.
- `firstMismatchAt` — the sequence number of the first divergent entry, when `matches` is false.

The CLI exits with a non-zero status when `matches` is false, so `a2amesh replay` can gate CI.

## Regression-testing a changed adapter

Pass `handleTask` to replay a golden cassette's recorded prompt against a **different** implementation, to check whether a code change altered observable behavior:

```typescript
import { replayCassette } from '@a2amesh/runtime/testing';

const result = await replayCassette(goldenCassette, {
  handleTask: async (task, message) => myUpdatedAdapter.handleTask(task, message),
});

if (!result.matches) {
  throw new Error(`adapter output diverged at sequence ${result.firstMismatchAt}`);
}
```

## Determinism guarantees and limits

Replay guarantees the same `reason` order, `TaskState` sequence, and message/artifact content as the recording. It does **not** guarantee identical wall-clock timestamps, derived timing metadata (`startedAt`/`endedAt`/`durationMs`), or an identical generated task id — these are excluded from the comparison rather than forced to match, since task lifecycle timestamps read the real system clock. See ADR-0011 for the full rationale.

`push-config` events, raw JSON-RPC/SSE transport frames, and a flight-recorder ring buffer are explicitly out of scope for this first cassette implementation — recording and replay operate at the `TaskManager` lifecycle level, which already captures every semantically meaningful state change a task goes through.

## Verification commands

```bash
pnpm --filter @a2amesh/runtime run test
pnpm run test:integration
pnpm run schemas:check
pnpm run lint:md
```
