import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import {
  countSqliteTasks,
  getAllTasksFromSqlite,
  getTaskFromSqlite,
  getTasksByContextIdFromSqlite,
  insertTaskIntoSqlite,
  saveTaskToSqlite,
  type SqliteTaskOperationOptions,
} from '../src/storage/SqliteTaskStorageTasks.js';
import type { Task } from '../src/types/task.js';

function createDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
  initializeSqliteTaskStorage(db, { now: () => new Date('2026-07-29T16:00:00.000Z') });
  return db;
}

function createTask(
  id: string,
  options: {
    contextId?: string;
    state?: Task['status']['state'];
    tenantId?: string;
  } = {},
): Task {
  return {
    kind: 'task',
    id,
    ...(options.contextId ? { contextId: options.contextId } : {}),
    status: {
      state: options.state ?? 'SUBMITTED',
      timestamp: '2026-07-29T16:00:00.000Z',
    },
    history: [],
    artifacts: [],
    metadata: { tenantId: options.tenantId ?? 'tenant-a' },
    extensions: [],
  };
}

describe('SQLite task operations', () => {
  it('inserts and retrieves cloned tasks while emitting the creation audit action', () => {
    const db = createDatabase();
    const appendTaskAudit = vi.fn<SqliteTaskOperationOptions['appendTaskAudit']>();
    const options = {
      defaultTenantId: 'default',
      now: () => new Date('2026-07-29T16:00:00.000Z'),
      appendTaskAudit,
    };
    const task = createTask('task-1', { contextId: 'context-a' });

    const inserted = insertTaskIntoSqlite(db, task, options);
    inserted.metadata = { mutated: true };

    expect(getTaskFromSqlite(db, task.id)).toEqual(task);
    expect(appendTaskAudit).toHaveBeenCalledWith(
      task,
      'tenant-a',
      'task.created',
      'success',
      options.now,
    );
    db.close?.();
  });

  it('records state transitions and keeps ordered task queries deterministic', () => {
    const db = createDatabase();
    const appendTaskAudit = vi.fn<SqliteTaskOperationOptions['appendTaskAudit']>();
    const options = {
      defaultTenantId: 'default',
      now: () => new Date('2026-07-29T16:00:00.000Z'),
      appendTaskAudit,
    };
    insertTaskIntoSqlite(db, createTask('task-b', { contextId: 'shared' }), options);
    insertTaskIntoSqlite(db, createTask('task-a', { contextId: 'shared' }), options);
    appendTaskAudit.mockClear();

    const task = getTaskFromSqlite(db, 'task-a');
    if (!task) throw new Error('task-a missing');
    task.status.state = 'WORKING';
    saveTaskToSqlite(db, task, options);

    expect(getAllTasksFromSqlite(db).map((entry) => entry.id)).toEqual(['task-a', 'task-b']);
    expect(getTasksByContextIdFromSqlite(db, 'shared')).toHaveLength(2);
    expect(countSqliteTasks(db)).toBe(2);
    expect(appendTaskAudit).toHaveBeenCalledWith(
      task,
      'tenant-a',
      'task.transition.SUBMITTED.WORKING',
      'success',
      options.now,
    );
    db.close?.();
  });
});
