import type {
  ITrustLogStorage,
  TrustLogEntry,
  TrustLogEntryInput,
  TrustLogListFilter,
} from './ITrustLogStorage.js';
import { computeTrustLogEntryHash, TRUST_LOG_GENESIS_HASH } from './trustLogHashChain.js';

export interface RegistryRedisTrustLogTransaction {
  rPush(key: string, value: string): RegistryRedisTrustLogTransaction;
  set(key: string, value: string): RegistryRedisTrustLogTransaction;
  exec(): Promise<unknown>;
}

export interface RegistryRedisTrustLogClient {
  watch(keys: string | string[]): Promise<unknown>;
  unwatch(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  lLen(key: string): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  multi(): RegistryRedisTrustLogTransaction;
}

export interface RedisTrustLogStorageOptions {
  maxAppendAttempts?: number;
}

function isWatchConflict(error: unknown): boolean {
  return error instanceof Error && error.name === 'WatchError';
}

function parseEntry(value: string): TrustLogEntry {
  const parsed = JSON.parse(value) as Partial<TrustLogEntry>;
  if (
    !Number.isSafeInteger(parsed.sequence) ||
    typeof parsed.cardHash !== 'string' ||
    typeof parsed.keyId !== 'string' ||
    typeof parsed.algorithm !== 'string' ||
    typeof parsed.agentUrl !== 'string' ||
    (parsed.tenantId !== undefined && typeof parsed.tenantId !== 'string') ||
    typeof parsed.timestamp !== 'string' ||
    typeof parsed.entryHash !== 'string'
  ) {
    throw new Error('Redis trust log contains an invalid entry.');
  }
  return parsed as TrustLogEntry;
}

/**
 * Shared Redis trust-log storage for multi-process registry deployments.
 *
 * Appends are serialized inside one process and use optimistic Redis WATCH
 * transactions across processes. The dedicated client passed to this class
 * must not be shared with unrelated WATCH/MULTI operations.
 */
export class RedisTrustLogStorage implements ITrustLogStorage {
  private readonly entriesKey: string;
  private readonly headKey: string;
  private readonly maxAppendAttempts: number;
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: RegistryRedisTrustLogClient,
    prefix = 'a2a:registry',
    options: RedisTrustLogStorageOptions = {},
  ) {
    const normalizedPrefix = prefix.replace(/:+$/u, '');
    const namespace = `${normalizedPrefix}:{trust-log}`;
    this.entriesKey = `${namespace}:entries`;
    this.headKey = `${namespace}:head`;
    this.maxAppendAttempts = options.maxAppendAttempts ?? 20;
    if (!Number.isSafeInteger(this.maxAppendAttempts) || this.maxAppendAttempts < 1) {
      throw new Error('Redis trust-log maxAppendAttempts must be a positive integer.');
    }
  }

  append(entry: TrustLogEntryInput): Promise<TrustLogEntry> {
    const operation = this.appendQueue.then(() => this.appendWithRetry(entry));
    this.appendQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async list(filter: TrustLogListFilter = {}): Promise<TrustLogEntry[]> {
    const serialized = await this.client.lRange(this.entriesKey, 0, -1);
    const entries = serialized.map(parseEntry);
    const filtered = filter.cardHash
      ? entries.filter((entry) => entry.cardHash === filter.cardHash)
      : entries;
    return filter.limit ? filtered.slice(-filter.limit) : filtered;
  }

  private async appendWithRetry(entry: TrustLogEntryInput): Promise<TrustLogEntry> {
    for (let attempt = 1; attempt <= this.maxAppendAttempts; attempt += 1) {
      try {
        await this.client.watch([this.entriesKey, this.headKey]);
        const [previousHash, sequence] = await Promise.all([
          this.client.get(this.headKey),
          this.client.lLen(this.entriesKey),
        ]);
        const entryHash = computeTrustLogEntryHash(previousHash ?? TRUST_LOG_GENESIS_HASH, {
          ...entry,
          sequence,
        });
        const recorded: TrustLogEntry = { ...entry, sequence, entryHash };
        await this.client
          .multi()
          .rPush(this.entriesKey, JSON.stringify(recorded))
          .set(this.headKey, entryHash)
          .exec();
        return recorded;
      } catch (error) {
        if (!isWatchConflict(error) || attempt === this.maxAppendAttempts) {
          throw error;
        }
      } finally {
        await this.client.unwatch().catch(() => undefined);
      }
    }
    throw new Error('Redis trust-log append attempts exhausted.');
  }
}
