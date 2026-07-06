import type { SqliteDatabase } from '@a2amesh/runtime';

interface Migration {
  version: number;
  apply(db: SqliteDatabase): void;
}

interface VersionRow {
  version: number;
}

export interface SqliteTrustLogMigrationOptions {
  busyTimeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

const SQLITE_TRUST_LOG_STORAGE_SCHEMA_VERSION = 1;

const migrations: readonly Migration[] = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trust_log (
          sequence INTEGER PRIMARY KEY,
          card_hash TEXT NOT NULL,
          key_id TEXT NOT NULL,
          algorithm TEXT NOT NULL,
          agent_url TEXT NOT NULL,
          tenant_id TEXT,
          timestamp TEXT NOT NULL,
          entry_hash TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trust_log_card_hash ON trust_log(card_hash);
      `);
    },
  },
];

export function initializeSqliteTrustLogStorage(
  db: SqliteDatabase,
  options: SqliteTrustLogMigrationOptions = {},
): void {
  const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs ?? 5_000);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = ${busyTimeoutMs};
    CREATE TABLE IF NOT EXISTS storage_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersion = getSqliteTrustLogSchemaVersion(db);
  if (currentVersion > SQLITE_TRUST_LOG_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite trust log storage schema ${currentVersion} is newer than supported version ${SQLITE_TRUST_LOG_STORAGE_SCHEMA_VERSION}`,
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.apply(db);
      db.prepare('INSERT INTO storage_schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        (options.now ?? (() => new Date()))().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`SQLite trust log storage migration ${migration.version} failed`, {
        cause: error,
      });
    }
  }
}

function getSqliteTrustLogSchemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare<VersionRow>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM storage_schema_migrations',
    )
    .get();
  return row?.version ?? 0;
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 120_000) {
    throw new Error('busyTimeoutMs must be an integer between 0 and 120000');
  }
  return value;
}
