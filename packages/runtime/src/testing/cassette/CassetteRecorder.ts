/**
 * @file CassetteRecorder.ts
 * Subscribes to a `TaskManager`'s `taskUpdated` events and builds an
 * ordered, integrity-hash-chained `Cassette` for later replay
 * (`ReplayEngine.replayCassette`).
 */

import { createHash } from 'node:crypto';
import type { TaskManager, TaskUpdatedEvent } from '../../server/TaskManager.js';
import type { Cassette, CassetteEntry, CassetteHeader } from '../../types/cassette.js';
import { canonicalJsonStringify } from './canonicalJson.js';
import { redactTask } from './redaction.js';

export interface CassetteRecorderOptions {
  /** Only record events for this task id; records every task when omitted. */
  taskId?: string;
  /** Redact secret-shaped content from recorded task snapshots. Defaults to true. */
  redact?: boolean;
  /** SHA-256 hash of the serving agent card, recorded in the cassette header for provenance. */
  cardHash?: string;
  runtimeVersion?: string;
  now?: () => Date;
}

const DEFAULT_RUNTIME_VERSION = 'unknown';

function computeIntegrityHash(previousHash: string, entryWithoutHash: unknown): string {
  return createHash('sha256')
    .update(previousHash)
    .update(canonicalJsonStringify(entryWithoutHash))
    .digest('hex');
}

function computeHeaderHash(header: CassetteHeader): string {
  return createHash('sha256').update(canonicalJsonStringify(header)).digest('hex');
}

/**
 * Records the `taskUpdated` event stream of a `TaskManager` into a
 * `Cassette`. Recording is entirely opt-in: nothing subscribes unless
 * `attach()` is called, so an unconfigured server pays no cost.
 */
export class CassetteRecorder {
  private readonly entries: CassetteEntry[] = [];
  private readonly redact: boolean;
  private readonly now: () => Date;
  private header: CassetteHeader | undefined;
  private lastHash: string | undefined;

  constructor(private readonly options: CassetteRecorderOptions = {}) {
    this.redact = options.redact ?? true;
    this.now = options.now ?? (() => new Date());
  }

  /** Subscribes to `taskManager`'s `taskUpdated` events. Returns an unsubscribe function. */
  attach(taskManager: TaskManager): () => void {
    const listener = (event: TaskUpdatedEvent): void => this.record(event);
    taskManager.on('taskUpdated', listener);
    return () => taskManager.off('taskUpdated', listener);
  }

  private record(event: TaskUpdatedEvent): void {
    if (this.options.taskId && event.task.id !== this.options.taskId) return;

    if (!this.header) {
      this.header = {
        formatVersion: '1',
        runtimeVersion: this.options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
        taskId: event.task.id,
        recordedAt: this.now().toISOString(),
        redacted: this.redact,
        ...(this.options.cardHash ? { cardHash: this.options.cardHash } : {}),
      };
      this.lastHash = computeHeaderHash(this.header);
    }

    const task = this.redact ? redactTask(event.task) : event.task;
    const entryWithoutHash: Omit<CassetteEntry, 'integrityHash'> = {
      sequence: this.entries.length,
      recordedAt: this.now().toISOString(),
      reason: event.reason,
      task,
      ...(event.previousState ? { previousState: event.previousState } : {}),
    };
    const integrityHash = computeIntegrityHash(this.lastHash ?? '', entryWithoutHash);
    this.lastHash = integrityHash;
    this.entries.push({ ...entryWithoutHash, integrityHash });
  }

  toCassette(): Cassette {
    if (!this.header) {
      throw new Error('CassetteRecorder has not observed any taskUpdated events yet');
    }
    return { header: this.header, entries: [...this.entries] };
  }

  /** True once at least one `taskUpdated` event has been recorded. */
  hasRecording(): boolean {
    return this.header !== undefined;
  }
}

/** Serializes a cassette as JSONL: the header on the first line, one entry per following line. */
export function serializeCassetteToJsonl(cassette: Cassette): string {
  const lines = [
    JSON.stringify(cassette.header),
    ...cassette.entries.map((entry) => JSON.stringify(entry)),
  ];
  return lines.join('\n') + '\n';
}

/** Parses a cassette previously serialized by `serializeCassetteToJsonl`. */
export function parseCassetteFromJsonl(jsonl: string): Cassette {
  const lines = jsonl.split('\n').filter((line) => line.trim().length > 0);
  const [headerLine, ...entryLines] = lines;
  if (!headerLine) {
    throw new Error('cassette JSONL is empty');
  }
  const header = JSON.parse(headerLine) as CassetteHeader;
  const entries = entryLines.map((line) => JSON.parse(line) as CassetteEntry);
  return { header, entries };
}

export { computeIntegrityHash as computeCassetteEntryIntegrityHash, computeHeaderHash };
