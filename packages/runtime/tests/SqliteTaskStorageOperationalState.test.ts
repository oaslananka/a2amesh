import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  SQLITE_TASK_STORAGE_SCHEMA_VERSION,
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import { getSqliteTaskStorageOperationalState } from '../src/storage/SqliteTaskStorageOperationalState.js';

describe('SQLite operational-state inspection', () => {
  it('reports schema, journal, timeout, and sorted task indexes', () => {
    const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
    initializeSqliteTaskStorage(db, { busyTimeoutMs: 3_456 });

    const state = getSqliteTaskStorageOperationalState(db);

    expect(state).toEqual(
      expect.objectContaining({
        schemaVersion: SQLITE_TASK_STORAGE_SCHEMA_VERSION,
        journalMode: 'memory',
        busyTimeoutMs: 3_456,
      }),
    );
    expect(state.indexes).toEqual([
      'idx_tasks_context_id',
      'idx_tasks_context_id_id',
      'idx_tasks_expires_at',
      'idx_tasks_status',
      'idx_tasks_tenant_id',
      'idx_tasks_tenant_status_updated',
      'idx_tasks_updated_at',
      'sqlite_autoindex_tasks_1',
    ]);
    db.close?.();
  });
});
