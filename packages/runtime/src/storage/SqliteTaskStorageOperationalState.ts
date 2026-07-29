import { getSqliteSchemaVersion, type SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import { type IndexRow, type PragmaValueRow } from './SqliteTaskStorageRecords.js';
import type { SqliteTaskStorageOperationalState } from './TaskStorageContracts.js';

export function getSqliteTaskStorageOperationalState(
  db: SqliteDatabase,
): SqliteTaskStorageOperationalState {
  const journalMode = db.prepare<PragmaValueRow>('PRAGMA journal_mode').get()?.journal_mode ?? '';
  const busyTimeoutMs = db.prepare<PragmaValueRow>('PRAGMA busy_timeout').get()?.timeout ?? 0;
  const indexes = db
    .prepare<IndexRow>('PRAGMA index_list(tasks)')
    .all()
    .map((row) => row.name)
    .sort((left, right) => left.localeCompare(right));
  return { schemaVersion: getSqliteSchemaVersion(db), journalMode, busyTimeoutMs, indexes };
}
