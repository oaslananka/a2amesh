import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import {
  getPushNotificationConfigFromSqlite,
  getPushNotificationFromSqlite,
  listPushNotificationsFromSqlite,
  removePushNotificationConfigFromSqlite,
  removePushNotificationFromSqlite,
  setPushNotificationConfigInSqlite,
  setPushNotificationInSqlite,
} from '../src/storage/SqliteTaskStoragePushNotifications.js';
import { insertTaskIntoSqlite } from '../src/storage/SqliteTaskStorageTasks.js';
import type { Task } from '../src/types/task.js';

function createDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
  initializeSqliteTaskStorage(db, { now: () => new Date('2026-07-29T17:00:00.000Z') });
  return db;
}

function createTask(id: string): Task {
  return {
    kind: 'task',
    id,
    status: { state: 'SUBMITTED', timestamp: '2026-07-29T17:00:00.000Z' },
    history: [],
    artifacts: [],
    metadata: { tenantId: 'tenant-a' },
    extensions: [],
  };
}

function insertTask(db: SqliteDatabase, taskId: string): void {
  insertTaskIntoSqlite(db, createTask(taskId), {
    defaultTenantId: 'default',
    now: () => new Date('2026-07-29T17:00:00.000Z'),
    appendTaskAudit() {},
  });
}

describe('SQLite push-notification operations', () => {
  it('fails closed for missing tasks and round-trips isolated default and named configs', () => {
    const db = createDatabase();
    expect(
      setPushNotificationInSqlite(db, 'missing', {
        url: 'https://example.test/missing',
      }),
    ).toBeUndefined();

    insertTask(db, 'task-1');
    const storedDefault = setPushNotificationInSqlite(db, 'task-1', {
      url: 'https://example.test/default',
      token: 'secret',
    });
    if (!storedDefault) throw new Error('default config missing');
    storedDefault.url = 'https://mutated.invalid';

    expect(getPushNotificationFromSqlite(db, 'task-1')).toEqual({
      url: 'https://example.test/default',
      token: 'secret',
    });
    expect(
      setPushNotificationConfigInSqlite(db, 'task-1', 'email', {
        url: 'https://example.test/email',
      }),
    ).toEqual({ url: 'https://example.test/email' });
    expect(getPushNotificationConfigFromSqlite(db, 'task-1', 'email')).toEqual({
      url: 'https://example.test/email',
    });
    expect(listPushNotificationsFromSqlite(db, 'task-1')).toHaveLength(2);
    db.close?.();
  });

  it('removes named and default configs and deletes the empty persistence row', () => {
    const db = createDatabase();
    insertTask(db, 'task-1');
    setPushNotificationInSqlite(db, 'task-1', {
      url: 'https://example.test/default',
    });
    setPushNotificationConfigInSqlite(db, 'task-1', 'email', {
      url: 'https://example.test/email',
    });

    expect(removePushNotificationConfigFromSqlite(db, 'task-1', 'missing')).toBe(false);
    expect(removePushNotificationConfigFromSqlite(db, 'task-1', 'email')).toBe(true);
    expect(listPushNotificationsFromSqlite(db, 'task-1')).toHaveLength(1);
    expect(removePushNotificationFromSqlite(db, 'task-1')).toBe(true);
    expect(listPushNotificationsFromSqlite(db, 'task-1')).toEqual([]);
    expect(
      db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM push_notifications').get(),
    ).toEqual({ count: 0 });
    db.close?.();
  });
});
