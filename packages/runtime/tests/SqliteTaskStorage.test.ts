import { describe, expect, it } from 'vitest';
import { AsyncSqliteTaskStorage, SqliteTaskStorage } from '../src/storage/SqliteTaskStorage.js';
import type { Task } from '../src/types/task.js';

interface FakeSqliteStatement<TRow = unknown> {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): TRow | undefined;
  all(...params: unknown[]): TRow[];
}

interface StoredTaskRow {
  contextId: string | null;
  taskJson: string;
}

interface FakeTaskJsonRow {
  task_json: string;
}

interface FakePushNotificationRow {
  config_json: string;
}

class FakeDatabase {
  readonly executedSql: string[] = [];
  readonly tasks = new Map<string, StoredTaskRow>();
  readonly pushNotifications = new Map<string, string>();
  readonly migrations = new Map<number, string>();
  closed = false;

  exec(sql: string): void {
    this.executedSql.push(sql);
  }

  prepare<TRow = unknown>(sql: string): FakeSqliteStatement<TRow> {
    return new FakeStatement<TRow>(this, sql);
  }

  close(): void {
    this.closed = true;
  }

  run(sql: string, params: unknown[]): { changes: number } {
    if (sql.startsWith('INSERT OR IGNORE INTO storage_schema_migrations')) {
      const version = Number(params[0]);
      if (!this.migrations.has(version)) {
        this.migrations.set(version, String(params[1]));
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (sql.startsWith('INSERT INTO tasks')) {
      const id = String(params[0]);
      const contextId = typeof params[1] === 'string' ? params[1] : null;
      this.tasks.set(id, {
        contextId,
        taskJson: String(params[2]),
      });
      return { changes: 1 };
    }

    if (sql.startsWith('UPDATE tasks')) {
      const id = String(params[2]);
      if (!this.tasks.has(id)) {
        return { changes: 0 };
      }
      this.tasks.set(id, {
        contextId: typeof params[0] === 'string' ? params[0] : null,
        taskJson: String(params[1]),
      });
      return { changes: 1 };
    }

    if (sql.startsWith('INSERT INTO push_notifications')) {
      this.pushNotifications.set(String(params[0]), String(params[1]));
      return { changes: 1 };
    }

    if (sql.startsWith('DELETE FROM push_notifications WHERE task_id')) {
      return { changes: this.pushNotifications.delete(String(params[0])) ? 1 : 0 };
    }

    if (sql.startsWith('DELETE FROM tasks WHERE id')) {
      return { changes: this.tasks.delete(String(params[0])) ? 1 : 0 };
    }

    if (sql === 'DELETE FROM push_notifications') {
      const changes = this.pushNotifications.size;
      this.pushNotifications.clear();
      return { changes };
    }

    if (sql === 'DELETE FROM tasks') {
      const changes = this.tasks.size;
      this.tasks.clear();
      return { changes };
    }

    throw new Error(`Unexpected SQL run: ${sql}`);
  }

  get(sql: string, params: unknown[]): unknown {
    if (sql.startsWith('SELECT task_json FROM tasks WHERE id')) {
      const row = this.tasks.get(String(params[0]));
      return row ? ({ task_json: row.taskJson } satisfies FakeTaskJsonRow) : undefined;
    }

    if (sql.startsWith('SELECT config_json FROM push_notifications')) {
      const config = this.pushNotifications.get(String(params[0]));
      return config ? ({ config_json: config } satisfies FakePushNotificationRow) : undefined;
    }

    if (sql.startsWith('SELECT COUNT(*) AS count FROM tasks')) {
      return { count: this.tasks.size };
    }

    throw new Error(`Unexpected SQL get: ${sql}`);
  }

  all(sql: string, params: unknown[]): unknown[] {
    if (sql.startsWith('SELECT task_json FROM tasks WHERE context_id')) {
      const contextId = String(params[0]);
      return [...this.tasks.entries()]
        .filter(([, row]) => row.contextId === contextId)
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([, row]) => ({ task_json: row.taskJson }) satisfies FakeTaskJsonRow);
    }

    if (sql.startsWith('SELECT task_json FROM tasks ORDER BY id')) {
      return [...this.tasks.entries()]
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([, row]) => ({ task_json: row.taskJson }) satisfies FakeTaskJsonRow);
    }

    throw new Error(`Unexpected SQL all: ${sql}`);
  }
}

class FakeStatement<TRow> implements FakeSqliteStatement<TRow> {
  constructor(
    private readonly database: FakeDatabase,
    private readonly sql: string,
  ) {}

  run(...params: unknown[]): { changes: number } {
    return this.database.run(this.sql, params);
  }

  get(...params: unknown[]): TRow | undefined {
    return this.database.get(this.sql, params) as TRow | undefined;
  }

  all(...params: unknown[]): TRow[] {
    return this.database.all(this.sql, params) as TRow[];
  }
}

function createTask(id: string, contextId?: string): Task {
  return {
    kind: 'task',
    id,
    status: {
      state: 'SUBMITTED',
      timestamp: new Date().toISOString(),
    },
    history: [],
    artifacts: [],
    metadata: {},
    extensions: [],
    ...(contextId ? { contextId } : {}),
  };
}

describe('SqliteTaskStorage', () => {
  it('persists tasks, context lookups and push notification configuration with an injected driver', () => {
    const FakeDatabaseConstructor = class extends FakeDatabase {
      static readonly instances: FakeDatabase[] = [];

      constructor(readonly path: string) {
        super();
        FakeDatabaseConstructor.instances.push(this);
      }
    };

    const storage = new SqliteTaskStorage(':memory:', FakeDatabaseConstructor);
    const database = FakeDatabaseConstructor.instances[0];
    if (!database) {
      throw new Error('Expected fake database to be constructed');
    }
    const initializedSql = database.executedSql.join('\n');
    expect(initializedSql).toContain('PRAGMA journal_mode = WAL');
    expect(initializedSql).toContain('PRAGMA foreign_keys = ON');
    expect(initializedSql).toContain('CREATE TABLE IF NOT EXISTS storage_schema_migrations');
    expect(initializedSql).toContain('REFERENCES tasks(id) ON DELETE CASCADE');
    expect(initializedSql).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_context_id_id');
    expect(database.migrations.has(1)).toBe(true);

    const inserted = storage.insertTask(createTask('task-1', 'ctx-1'));

    inserted.metadata = { mutated: true };
    expect(storage.getTask('task-1')?.metadata).toEqual({});
    expect(storage.getTask('missing')).toBeUndefined();

    const storedTask = storage.getTask('task-1');
    if (!storedTask) {
      throw new Error('Expected stored task to exist');
    }

    storedTask.contextId = 'ctx-2';
    storedTask.status.state = 'WORKING';
    storage.saveTask(storedTask);
    storage.saveTask(createTask('missing'));

    expect(storage.getTasksByContextId('ctx-1')).toEqual([]);
    expect(storage.getTasksByContextId('ctx-2')).toHaveLength(1);
    expect(storage.getAllTasks()).toEqual([
      expect.objectContaining({
        id: 'task-1',
        contextId: 'ctx-2',
        status: expect.objectContaining({ state: 'WORKING' }),
      }),
    ]);

    expect(
      storage.setPushNotification('missing', { url: 'https://example.com/missing' }),
    ).toBeUndefined();

    const config = storage.setPushNotification('task-1', {
      url: 'https://example.com/hook',
      token: 'secret',
    });

    expect(config).toEqual({
      url: 'https://example.com/hook',
      token: 'secret',
    });
    expect(storage.getPushNotification('task-1')).toEqual(config);
    expect(storage.getPushNotification('missing')).toBeUndefined();

    expect(
      storage.setPushNotificationConfig('task-1', 'email', {
        url: 'https://example.com/email',
      }),
    ).toEqual({ url: 'https://example.com/email' });
    expect(
      storage.setPushNotificationConfig('task-1', 'pager', {
        id: 'pager',
        url: 'https://example.com/pager',
      }),
    ).toEqual({ id: 'pager', url: 'https://example.com/pager' });
    expect(storage.listPushNotifications('task-1')).toEqual([
      config,
      { url: 'https://example.com/email' },
      { id: 'pager', url: 'https://example.com/pager' },
    ]);
    expect(storage.getPushNotificationConfig('task-1', 'email')).toEqual({
      url: 'https://example.com/email',
    });
    expect(storage.removePushNotificationConfig('task-1', 'email')).toBe(true);
    expect(storage.removePushNotificationConfig('task-1', 'missing')).toBe(false);
    expect(storage.getPushNotificationConfig('task-1', 'email')).toBeUndefined();

    expect(storage.count()).toBe(1);
    expect(storage.deleteTask('missing')).toBe(false);
    expect(storage.deleteTask('task-1')).toBe(true);
    expect(storage.getTask('task-1')).toBeUndefined();
    expect(storage.getPushNotification('task-1')).toBeUndefined();

    storage.insertTask(createTask('task-2'));
    storage.clear();
    expect(storage.count()).toBe(0);

    storage.close();
    expect(database.closed).toBe(true);
  });

  it('serializes async sqlite push config operations and transactions', async () => {
    const FakeDatabaseConstructor = class extends FakeDatabase {
      static readonly instances: FakeDatabase[] = [];

      constructor(readonly path: string) {
        super();
        FakeDatabaseConstructor.instances.push(this);
      }
    };

    const storage = new AsyncSqliteTaskStorage(':memory:', FakeDatabaseConstructor);
    const database = FakeDatabaseConstructor.instances[0];
    if (!database) {
      throw new Error('Expected fake async database to be constructed');
    }

    await storage.insertTask(createTask('async-task', 'ctx-async'));
    await expect(storage.getAllTasks()).resolves.toHaveLength(1);
    await expect(storage.getTasksByContextId('ctx-async')).resolves.toHaveLength(1);
    await expect(
      storage.setPushNotification('async-task', {
        url: 'https://example.com/default',
      }),
    ).resolves.toEqual({ url: 'https://example.com/default' });
    await expect(
      storage.setPushNotificationConfig('async-task', 'email', {
        url: 'https://example.com/email',
      }),
    ).resolves.toEqual({ url: 'https://example.com/email' });
    await expect(storage.getPushNotification('async-task')).resolves.toEqual({
      url: 'https://example.com/default',
    });
    await expect(storage.getPushNotificationConfig('async-task', 'email')).resolves.toEqual({
      url: 'https://example.com/email',
    });
    await expect(storage.listPushNotifications('async-task')).resolves.toEqual([
      { url: 'https://example.com/default' },
      { url: 'https://example.com/email' },
    ]);
    await expect(storage.removePushNotificationConfig('async-task', 'email')).resolves.toBe(true);
    await expect(storage.removePushNotification('async-task')).resolves.toBe(true);

    await storage.transaction(async (transaction) => {
      const task = await transaction.getTask('async-task');
      if (!task) {
        throw new Error('Expected async task in transaction');
      }
      task.extensions = ['urn:test:sqlite-async'];
      await transaction.saveTask(task);
    });
    await expect(storage.getTask('async-task')).resolves.toEqual(
      expect.objectContaining({ extensions: ['urn:test:sqlite-async'] }),
    );

    await expect(
      storage.transaction(async () => {
        throw new Error('rollback me');
      }),
    ).rejects.toThrow('rollback me');
    expect(database.executedSql).toContain('ROLLBACK');

    await storage.clear();
    await expect(storage.count()).resolves.toBe(0);
    await storage.close();
    expect(database.closed).toBe(true);
  });
});
