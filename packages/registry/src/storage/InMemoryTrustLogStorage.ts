import type {
  ITrustLogStorage,
  TrustLogEntry,
  TrustLogEntryInput,
  TrustLogListFilter,
} from './ITrustLogStorage.js';
import { computeTrustLogEntryHash, TRUST_LOG_GENESIS_HASH } from './trustLogHashChain.js';

export class InMemoryTrustLogStorage implements ITrustLogStorage {
  private readonly entries: TrustLogEntry[] = [];
  private lastHash = TRUST_LOG_GENESIS_HASH;

  async append(entry: TrustLogEntryInput): Promise<TrustLogEntry> {
    const sequence = this.entries.length;
    const entryHash = computeTrustLogEntryHash(this.lastHash, { ...entry, sequence });
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
