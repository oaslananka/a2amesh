import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  getSqliteSchemaVersion,
  initializeSqliteTaskStorage,
  SQLITE_TASK_STORAGE_SCHEMA_VERSION,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import { SqliteTaskStorage } from '../src/storage/SqliteTaskStorage.js';

describe('initializeSqliteTaskStorage', () => {
  it('applies all migrations using its own default clock when no now() is supplied', () => {
    const db = new DatabaseSync(':memory:');
    initializeSqliteTaskStorage(db);
    expect(getSqliteSchemaVersion(db)).toBe(SQLITE_TASK_STORAGE_SCHEMA_VERSION);
    db.close();
  });

  it('rejects a busyTimeoutMs outside the supported range', () => {
    expect(() => new SqliteTaskStorage(':memory:', { busyTimeoutMs: -1 })).toThrow(
      'busyTimeoutMs must be an integer between 0 and 120000',
    );
    expect(() => new SqliteTaskStorage(':memory:', { busyTimeoutMs: 200_000 })).toThrow(
      'busyTimeoutMs must be an integer between 0 and 120000',
    );
  });
});
