import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  clearSqliteTaskStorage,
  deleteTaskFromSqlite,
} from '../src/storage/SqliteTaskStorageLifecycle.js';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import { setPushNotificationInSqlite } from '../src/storage/SqliteTaskStoragePushNotifications.js';
import {
  getTaskFromSqlite,
  insertTaskIntoSqlite,
  type SqliteTaskOperationOptions,
} from '../src/storage/SqliteTaskStorageTasks.js';
import type { Task } from '../src/types/task.js';

function createDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
  initializeSqliteTaskStorage(db, { now: () => new Date('2026-07-29T18:00:00.000Z') });
  return db;
}

function createTask(id: string, tenantId = 'tenant-a'): Task {
  return {
    kind: 'task',
    id,
    status: { state: 'SUBMITTED', timestamp: '2026-07-29T18:00:00.000Z' },
    history: [],
    artifacts: [],
    metadata: { tenantId, principalId: 'principal-a', correlationId: 'correlation-a' },
    extensions: [],
  };
}

function insertTask(db: SqliteDatabase, task: Task): void {
  insertTaskIntoSqlite(db, task, {
    defaultTenantId: 'default',
    now: () => new Date('2026-07-29T18:00:00.000Z'),
    appendTaskAudit() {},
  });
}

describe('SQLite task lifecycle operations', () => {
  it('deletes a task and its push config while emitting one lifecycle audit event', () => {
    const db = createDatabase();
    const task = createTask('task-1');
    insertTask(db, task);
    setPushNotificationInSqlite(db, task.id, { url: 'https://example.test/push' });
    const appendTaskAudit = vi.fn<SqliteTaskOperationOptions['appendTaskAudit']>();
    const options = {
      defaultTenantId: 'default',
      now: () => new Date('2026-07-29T18:00:00.000Z'),
      appendTaskAudit,
    };

    expect(deleteTaskFromSqlite(db, 'missing', options)).toBe(false);
    expect(appendTaskAudit).not.toHaveBeenCalled();
    expect(deleteTaskFromSqlite(db, task.id, options)).toBe(true);
    expect(getTaskFromSqlite(db, task.id)).toBeUndefined();
    expect(
      db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM push_notifications').get(),
    ).toEqual({ count: 0 });
    expect(appendTaskAudit).toHaveBeenCalledWith(
      task,
      'tenant-a',
      'task.deleted',
      'success',
      options.now,
    );
    db.close?.();
  });

  it('clears task and push-notification persistence together', () => {
    const db = createDatabase();
    for (const taskId of ['task-a', 'task-b']) {
      insertTask(db, createTask(taskId));
      setPushNotificationInSqlite(db, taskId, { url: `https://example.test/${taskId}` });
    }

    clearSqliteTaskStorage(db);

    expect(db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM push_notifications').get(),
    ).toEqual({ count: 0 });
    db.close?.();
  });
});
