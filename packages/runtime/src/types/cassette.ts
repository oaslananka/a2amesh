/**
 * @file cassette.ts
 * Deterministic task record/replay ("cassette") types. A cassette captures
 * the ordered sequence of `TaskManager` `taskUpdated` events for a single
 * task as an integrity-hash-chained, redaction-aware, JSONL-serializable
 * document, so a previously recorded task lifecycle can later be replayed
 * without invoking a real adapter.
 */

import type { Task, TaskState } from './task.js';

export type CassetteEventReason = 'created' | 'message' | 'artifact' | 'state' | 'push-config';

export interface CassetteHeader {
  formatVersion: '1';
  runtimeVersion: string;
  taskId: string;
  recordedAt: string;
  redacted: boolean;
  cardHash?: string;
}

export interface CassetteEntry {
  sequence: number;
  recordedAt: string;
  reason: CassetteEventReason;
  task: Task;
  previousState?: TaskState;
  /**
   * SHA-256 hex digest over this entry's canonical content chained with the
   * previous entry's integrity hash (or the header's, for the first entry).
   * Any mutation to a recorded entry breaks every subsequent hash.
   */
  integrityHash: string;
}

export interface Cassette {
  header: CassetteHeader;
  entries: CassetteEntry[];
}
