import { DatabaseSync } from 'node:sqlite';
import type { SqliteDatabase, SqliteDatabaseConstructor } from '@a2amesh/runtime';
import type {
  ITrustLogStorage,
  TrustLogEntry,
  TrustLogEntryInput,
  TrustLogListFilter,
} from './ITrustLogStorage.js';
import {
  initializeSqliteTrustLogStorage,
  type SqliteTrustLogMigrationOptions,
} from './SqliteTrustLogStorageMigrations.js';
import { computeTrustLogEntryHash, TRUST_LOG_GENESIS_HASH } from './trustLogHashChain.js';

export interface SqliteTrustLogStorageOptions extends SqliteTrustLogMigrationOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
}

interface TrustLogRow {
  sequence: number;
  card_hash: string;
  key_id: string;
  algorithm: string;
  agent_url: string;
  tenant_id: string | null;
  timestamp: string;
  entry_hash: string;
}

interface LastHashRow {
  entry_hash: string;
}

interface NextSequenceRow {
  next_sequence: number;
}

function mapRow(row: TrustLogRow): TrustLogEntry {
  return {
    sequence: row.sequence,
    cardHash: row.card_hash,
    keyId: row.key_id,
    algorithm: row.algorithm,
    agentUrl: row.agent_url,
    ...(row.tenant_id !== null ? { tenantId: row.tenant_id } : {}),
    timestamp: row.timestamp,
    entryHash: row.entry_hash,
  };
}

function getLastEntryHash(db: SqliteDatabase): string {
  const row = db
    .prepare<LastHashRow>('SELECT entry_hash FROM trust_log ORDER BY sequence DESC LIMIT 1')
    .get();
  return row?.entry_hash ?? TRUST_LOG_GENESIS_HASH;
}

function getNextSequence(db: SqliteDatabase): number {
  const row = db
    .prepare<NextSequenceRow>(
      'SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence FROM trust_log',
    )
    .get();
  return row?.next_sequence ?? 0;
}

function insertTrustLogEntry(db: SqliteDatabase, input: TrustLogEntryInput): TrustLogEntry {
  const sequence = getNextSequence(db);
  const previousHash = getLastEntryHash(db);
  const entryHash = computeTrustLogEntryHash(previousHash, { ...input, sequence });
  db.prepare(
    'INSERT INTO trust_log (sequence, card_hash, key_id, algorithm, agent_url, tenant_id, timestamp, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sequence,
    input.cardHash,
    input.keyId,
    input.algorithm,
    input.agentUrl,
    input.tenantId ?? null,
    input.timestamp,
    entryHash,
  );
  return { ...input, sequence, entryHash };
}

function listTrustLogEntries(db: SqliteDatabase, filter: TrustLogListFilter): TrustLogEntry[] {
  const limitClause = filter.limit ? ' LIMIT ?' : '';
  const rows = filter.cardHash
    ? db
        .prepare<TrustLogRow>(
          `SELECT sequence, card_hash, key_id, algorithm, agent_url, tenant_id, timestamp, entry_hash FROM trust_log WHERE card_hash = ? ORDER BY sequence DESC${limitClause}`,
        )
        .all(...(filter.limit ? [filter.cardHash, filter.limit] : [filter.cardHash]))
    : db
        .prepare<TrustLogRow>(
          `SELECT sequence, card_hash, key_id, algorithm, agent_url, tenant_id, timestamp, entry_hash FROM trust_log ORDER BY sequence DESC${limitClause}`,
        )
        .all(...(filter.limit ? [filter.limit] : []));
  return rows.map(mapRow).reverse();
}

function loadSqliteDatabase(): SqliteDatabaseConstructor {
  return DatabaseSync as unknown as SqliteDatabaseConstructor;
}

/**
 * SQLite-backed `ITrustLogStorage` -- same append-only hash chain as
 * `InMemoryTrustLogStorage` (they share `trustLogHashChain.ts`), but durable
 * across process restarts. Intended for registries that need the trust log
 * to survive beyond a single process lifetime; `InMemoryTrustLogStorage`
 * remains the default for tests and ephemeral deployments.
 */
export class SqliteTrustLogStorage implements ITrustLogStorage {
  private readonly db: SqliteDatabase;

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTrustLogStorageOptions,
  ) {
    const options =
      typeof databaseConstructorOrOptions === 'function'
        ? { databaseConstructor: databaseConstructorOrOptions }
        : (databaseConstructorOrOptions ?? {});
    const Database = options.databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    initializeSqliteTrustLogStorage(this.db, options);
  }

  async append(entry: TrustLogEntryInput): Promise<TrustLogEntry> {
    return insertTrustLogEntry(this.db, entry);
  }

  async list(filter: TrustLogListFilter = {}): Promise<TrustLogEntry[]> {
    return listTrustLogEntries(this.db, filter);
  }

  close(): void {
    this.db.close?.();
  }
}
