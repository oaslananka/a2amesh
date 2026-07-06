import { createHash } from 'node:crypto';
import type {
  ITrustLogStorage,
  TrustLogEntry,
  TrustLogEntryInput,
  TrustLogListFilter,
} from './ITrustLogStorage.js';

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

const GENESIS_HASH = createHash('sha256').update('a2amesh-trust-log-genesis').digest('hex');

export class InMemoryTrustLogStorage implements ITrustLogStorage {
  private readonly entries: TrustLogEntry[] = [];
  private lastHash = GENESIS_HASH;

  async append(entry: TrustLogEntryInput): Promise<TrustLogEntry> {
    const sequence = this.entries.length;
    const entryHash = createHash('sha256')
      .update(this.lastHash)
      .update(canonicalJsonStringify({ ...entry, sequence }))
      .digest('hex');
    const recorded: TrustLogEntry = { ...entry, sequence, entryHash };
    this.entries.push(recorded);
    this.lastHash = entryHash;
    return { ...recorded };
  }

  async list(filter: TrustLogListFilter = {}): Promise<TrustLogEntry[]> {
    const filtered = filter.cardHash
      ? this.entries.filter((entry) => entry.cardHash === filter.cardHash)
      : this.entries;
    const ordered = [...filtered].sort((left, right) => left.sequence - right.sequence);
    return (filter.limit ? ordered.slice(-filter.limit) : ordered).map((entry) => ({ ...entry }));
  }
}
