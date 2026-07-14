import type { SqliteDatabase } from '@a2amesh/runtime';

interface Migration {
  version: number;
  apply(db: SqliteDatabase): void;
}

interface VersionRow {
  version: number;
}

export interface SqliteFleetStorageMigrationOptions {
  busyTimeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

const SQLITE_FLEET_STORAGE_SCHEMA_VERSION = 2;

const migrations: readonly Migration[] = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS fleet_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          status TEXT NOT NULL,
          approval_state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          run_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fleet_runs_status ON fleet_runs(status);
        CREATE INDEX IF NOT EXISTS idx_fleet_runs_approval_state ON fleet_runs(approval_state);
        CREATE INDEX IF NOT EXISTS idx_fleet_runs_created_at ON fleet_runs(created_at);

        CREATE TABLE IF NOT EXISTS fleet_audit (
          sequence INTEGER PRIMARY KEY,
          run_id TEXT,
          task_id TEXT,
          action TEXT NOT NULL,
          actor TEXT,
          timestamp TEXT NOT NULL,
          detail_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_fleet_audit_run_id ON fleet_audit(run_id, sequence);
      `);
    },
  },
  {
    version: 2,
    apply(db) {
      db.exec(`
        ALTER TABLE fleet_runs ADD COLUMN tenant_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_fleet_runs_tenant_id ON fleet_runs(tenant_id, created_at);
        ALTER TABLE fleet_audit ADD COLUMN tenant_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_fleet_audit_tenant_id ON fleet_audit(tenant_id, sequence);
      `);
    },
  },
];

export function initializeSqliteFleetStorage(
  db: SqliteDatabase,
  options: SqliteFleetStorageMigrationOptions = {},
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

  const currentVersion = getSqliteFleetSchemaVersion(db);
  if (currentVersion > SQLITE_FLEET_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite fleet storage schema ${currentVersion} is newer than supported version ${SQLITE_FLEET_STORAGE_SCHEMA_VERSION}`,
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
      throw new Error(`SQLite fleet storage migration ${migration.version} failed`, {
        cause: error,
      });
    }
  }
}

function getSqliteFleetSchemaVersion(db: SqliteDatabase): number {
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
