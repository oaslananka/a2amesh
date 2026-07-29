import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import {
  appendAuditEntryToSqlite,
  appendTaskAuditFromTaskToSqlite,
  listAuditEntriesFromSqlite,
} from '../src/storage/SqliteTaskStorageAudit.js';
import type { Task } from '../src/types/task.js';

function createDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
  initializeSqliteTaskStorage(db, { now: () => new Date('2026-07-29T20:00:00.000Z') });
  return db;
}

function createTask(metadata: Record<string, unknown>): Task {
  return {
    kind: 'task',
    id: 'task-a',
    status: { state: 'SUBMITTED', timestamp: '2026-07-29T20:00:00.000Z' },
    history: [],
    artifacts: [],
    metadata,
    extensions: [],
  };
}

describe('SQLite audit journal operations', () => {
  it('appends ordered tenant-scoped entries and validates list limits', () => {
    const db = createDatabase();
    const now = () => new Date('2026-07-29T21:00:00.000Z');
    const first = appendAuditEntryToSqlite(
      db,
      {
        taskId: 'task-a',
        tenantId: 'tenant-a',
        action: 'custom.first',
        outcome: 'success',
        principalId: 'principal-a',
        correlationId: 'request-a',
      },
      now,
    );
    const second = appendAuditEntryToSqlite(
      db,
      {
        taskId: 'task-b',
        tenantId: 'tenant-a',
        action: 'custom.second',
        outcome: 'failure',
        timestamp: '2026-07-29T21:01:00.000Z',
      },
      now,
    );
    appendAuditEntryToSqlite(
      db,
      {
        taskId: 'task-a',
        tenantId: 'tenant-b',
        action: 'custom.other-tenant',
        outcome: 'denied',
      },
      now,
    );

    expect(first).toEqual({
      sequence: 1,
      taskId: 'task-a',
      tenantId: 'tenant-a',
      action: 'custom.first',
      outcome: 'success',
      timestamp: '2026-07-29T21:00:00.000Z',
      principalId: 'principal-a',
      correlationId: 'request-a',
    });
    expect(second.sequence).toBe(2);
    expect(second.timestamp).toBe('2026-07-29T21:01:00.000Z');
    expect(listAuditEntriesFromSqlite(db, 'tenant-a').map((entry) => entry.sequence)).toEqual([
      1, 2,
    ]);
    expect(listAuditEntriesFromSqlite(db, 'tenant-a', 'task-a')).toEqual([first]);
    expect(listAuditEntriesFromSqlite(db, 'tenant-a', undefined, 1)).toEqual([first]);
    expect(() => listAuditEntriesFromSqlite(db, 'tenant-a', undefined, 0)).toThrow(
      'Audit limit must be between 1 and 1000',
    );
    expect(() => listAuditEntriesFromSqlite(db, 'tenant-a', undefined, 1_001)).toThrow(
      'Audit limit must be between 1 and 1000',
    );
    db.close?.();
  });

  it('redacts and bounds task metadata before writing audit evidence', () => {
    const db = createDatabase();
    const entry = appendTaskAuditFromTaskToSqlite(
      db,
      createTask({
        principalId: ' token: super-secret ',
        correlationId: `  ${'r'.repeat(300)}  `,
      }),
      'tenant-a',
      'task.created',
      'success',
      () => new Date('2026-07-29T22:00:00.000Z'),
    );

    expect(entry.principalId).toBe('[REDACTED]');
    expect(entry.correlationId).toBe('r'.repeat(256));
    expect(JSON.stringify(entry)).not.toContain('super-secret');
    expect(listAuditEntriesFromSqlite(db, 'tenant-a', 'task-a')).toEqual([entry]);
    db.close?.();
  });
});
