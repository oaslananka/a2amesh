/**
 * @file ReplayEngine.ts
 * Verifies cassette integrity and replays a cassette's recorded task
 * lifecycle without invoking a real adapter — artifacts are served from the
 * cassette by default, or from a caller-supplied `handleTask` (useful for
 * regression-testing a new adapter implementation against a golden
 * cassette).
 */

import type { Artifact, Message, Task } from '../../types/task.js';
import type { Cassette, CassetteEntry } from '../../types/cassette.js';
import { InMemoryTaskStorage } from '../../storage/InMemoryTaskStorage.js';
import { TaskManager } from '../../server/TaskManager.js';
import { canonicalJsonStringify } from './canonicalJson.js';
import {
  CassetteRecorder,
  computeCassetteEntryIntegrityHash,
  computeHeaderHash,
} from './CassetteRecorder.js';

export interface CassetteIntegrityResult {
  valid: boolean;
  failedAtSequence?: number;
}

/**
 * Recomputes the integrity hash chain and compares it against each entry's
 * recorded `integrityHash`. Any mutation to a recorded entry (or to the
 * header) breaks every hash from that point forward.
 */
export function verifyCassetteIntegrity(cassette: Cassette): CassetteIntegrityResult {
  let previousHash = computeHeaderHash(cassette.header);
  for (const entry of cassette.entries) {
    const { integrityHash, ...rest } = entry;
    const expected = computeCassetteEntryIntegrityHash(previousHash, rest);
    if (expected !== integrityHash) {
      return { valid: false, failedAtSequence: entry.sequence };
    }
    previousHash = integrityHash;
  }
  return { valid: true };
}

export interface ReplayOptions {
  /** Serves artifacts for the replayed task instead of the cassette's recorded artifacts. */
  handleTask?: (task: Task, message: Message) => Promise<Artifact[]>;
  now?: () => Date;
}

export interface ReplayResult {
  matches: boolean;
  integrity: CassetteIntegrityResult;
  recordedEntries: readonly CassetteEntry[];
  replayedEntries: readonly CassetteEntry[];
  firstMismatchAt?: number;
}

/**
 * Replays a cassette's `created` -> `message` -> artifact(s) -> final
 * `state` lifecycle against a fresh, isolated `TaskManager` (no HTTP, no
 * real adapter), and reports whether the replayed `taskUpdated` sequence
 * matches the recorded one. The comparison ignores fields that are
 * expected to differ between a recording and a replay: the generated task
 * id, wall-clock timestamps, and derived timing metadata (`startedAt`,
 * `endedAt`, `durationMs`, ...). See `docs/architecture/adr/0011-cassette-record-replay.md`
 * for the full list of determinism guarantees and their limits.
 */
export async function replayCassette(
  cassette: Cassette,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const integrity = verifyCassetteIntegrity(cassette);

  const [createdEntry, ...rest] = cassette.entries;
  if (!createdEntry || createdEntry.reason !== 'created') {
    throw new Error('cassette has no "created" entry to replay from');
  }

  const taskManager = new TaskManager(new InMemoryTaskStorage());
  const recorder = new CassetteRecorder({
    redact: cassette.header.redacted,
    runtimeVersion: cassette.header.runtimeVersion,
    ...(cassette.header.cardHash ? { cardHash: cassette.header.cardHash } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  recorder.attach(taskManager);

  const task = taskManager.createTask(
    createdEntry.task.sessionId,
    createdEntry.task.contextId,
    createdEntry.task.principalId,
    createdEntry.task.tenantId,
  );

  // Replays every subsequent recorded event in order, driving the same
  // TaskManager calls that produced it. Each 'artifact' entry's snapshot
  // accumulates artifacts, so the newly added one is always the last
  // element; a caller-supplied `handleTask` substitutes for the *first*
  // 'artifact' entry only (subsequent recorded 'artifact' entries are
  // absorbed by that single handler call), matching how `A2AServer`
  // calls a real adapter exactly once per task. `push-config` entries are
  // out of scope for replay (see ADR-0011).
  let lastMessage: Message | undefined;
  let handlerInvoked = false;
  for (const entry of rest) {
    switch (entry.reason) {
      case 'message': {
        const message = entry.task.history.at(-1);
        if (message) {
          taskManager.addHistoryMessage(task.id, message);
          lastMessage = message;
        }
        break;
      }
      case 'artifact': {
        if (options.handleTask) {
          if (!handlerInvoked) {
            handlerInvoked = true;
            const artifacts = lastMessage ? await options.handleTask(task, lastMessage) : [];
            for (const artifact of artifacts) taskManager.addArtifact(task.id, artifact);
          }
        } else {
          const artifact = entry.task.artifacts?.at(-1);
          if (artifact) taskManager.addArtifact(task.id, artifact);
        }
        break;
      }
      case 'state': {
        taskManager.updateTaskState(task.id, entry.task.status.state);
        break;
      }
      case 'created':
      case 'push-config':
        break;
    }
  }

  const replayedEntries = recorder.toCassette().entries;
  const firstMismatchAt = findFirstStructuralMismatch(cassette.entries, replayedEntries);

  return {
    matches: integrity.valid && firstMismatchAt === undefined,
    integrity,
    recordedEntries: cassette.entries,
    replayedEntries,
    ...(firstMismatchAt !== undefined ? { firstMismatchAt } : {}),
  };
}

/** Fields expected to differ between a recording and a replay, excluded from the structural comparison. */
function normalizeEntryForComparison(entry: CassetteEntry): unknown {
  const { task, previousState, reason } = entry;
  return {
    reason,
    previousState,
    task: {
      sessionId: task.sessionId,
      contextId: task.contextId,
      principalId: task.principalId,
      tenantId: task.tenantId,
      status: { state: task.status.state, message: task.status.message },
      history: task.history,
      artifacts: task.artifacts,
      extensions: task.extensions,
    },
  };
}

function findFirstStructuralMismatch(
  recorded: readonly CassetteEntry[],
  replayed: readonly CassetteEntry[],
): number | undefined {
  const length = Math.max(recorded.length, replayed.length);
  for (let index = 0; index < length; index += 1) {
    const left = recorded[index];
    const right = replayed[index];
    if (!left || !right) return index;
    if (
      canonicalJsonStringify(normalizeEntryForComparison(left)) !==
      canonicalJsonStringify(normalizeEntryForComparison(right))
    ) {
      return index;
    }
  }
  return undefined;
}
