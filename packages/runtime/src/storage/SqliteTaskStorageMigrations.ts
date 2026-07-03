export interface SqliteStatement<TRow = unknown> {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): TRow | undefined;
  all(...params: unknown[]): TRow[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare<TRow = unknown>(sql: string): SqliteStatement<TRow>;
  close?(): void;
}

export interface SqliteDatabaseConstructor {
  new (path: string): SqliteDatabase;
}

export interface SqliteMigrationOptions {
  busyTimeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

interface Migration {
  version: number;
  apply(db: SqliteDatabase): void;
}

interface ColumnRow {
  name: string;
}

interface VersionRow {
  version: number;
}

export const SQLITE_TASK_STORAGE_SCHEMA_VERSION = 3;

const migrations: readonly Migration[] = [
  {
    version: 1,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          context_id TEXT,
          task_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS push_notifications (
          task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
          config_json TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    apply(db) {
      addColumnIfMissing(db, 'tasks', 'tenant_id', "TEXT NOT NULL DEFAULT 'default'");
      addColumnIfMissing(db, 'tasks', 'status', "TEXT NOT NULL DEFAULT 'SUBMITTED'");
      addColumnIfMissing(
        db,
        'tasks',
        'updated_at',
        "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'",
      );
      addColumnIfMissing(db, 'tasks', 'expires_at', 'TEXT');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_context_id ON tasks(context_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_context_id_id ON tasks(context_id, id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_tenant_id ON tasks(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_expires_at ON tasks(expires_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status_updated
          ON tasks(tenant_id, status, updated_at);
      `);
    },
  },
  {
    version: 3,
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_audit_journal (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          principal_id TEXT,
          action TEXT NOT NULL,
          outcome TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          correlation_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_task_audit_tenant_task_sequence
          ON task_audit_journal(tenant_id, task_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_task_audit_timestamp
          ON task_audit_journal(timestamp);

        CREATE TABLE IF NOT EXISTS task_artifacts (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          artifact_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          content_type TEXT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          payload_ref TEXT NOT NULL,
          size_bytes INTEGER,
          sensitivity TEXT NOT NULL,
          redacted INTEGER NOT NULL,
          provenance_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(task_id, artifact_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_artifacts_tenant_task
          ON task_artifacts(tenant_id, task_id);
        CREATE INDEX IF NOT EXISTS idx_task_artifacts_checksum
          ON task_artifacts(checksum_sha256);
      `);
    },
  },
];

export function initializeSqliteTaskStorage(
  db: SqliteDatabase,
  options: SqliteMigrationOptions = {},
): void {
  const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs ?? 5_000);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = ${busyTimeoutMs};
    CREATE TABLE IF NOT EXISTS storage_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const currentVersion = getSqliteSchemaVersion(db);
  if (currentVersion > SQLITE_TASK_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite task storage schema ${currentVersion} is newer than supported version ${SQLITE_TASK_STORAGE_SCHEMA_VERSION}`,
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
      throw new Error(`SQLite task storage migration ${migration.version} failed`, {
        cause: error,
      });
    }
  }
}

export function getSqliteSchemaVersion(db: SqliteDatabase): number {
  const row = db
    .prepare<VersionRow>(
      'SELECT COALESCE(MAX(version), 0) AS version FROM storage_schema_migrations',
    )
    .get();
  return row?.version ?? 0;
}

function addColumnIfMissing(
  db: SqliteDatabase,
  table: string,
  column: string,
  declaration: string,
): void {
  const columns = db.prepare<ColumnRow>(`PRAGMA table_info(${table})`).all();
  if (!columns.some((candidate) => candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }
}

function normalizeBusyTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 120_000) {
    throw new Error('busyTimeoutMs must be an integer between 0 and 120000');
  }
  return value;
}
