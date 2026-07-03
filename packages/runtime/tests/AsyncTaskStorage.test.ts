import { describe, expect, it } from 'vitest';
import { AsyncSqliteTaskStorage } from '../src/storage/SqliteTaskStorage.js';
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

class FakeTransactionalDatabase {
  readonly executedSql: string[] = [];
  readonly tasks = new Map<string, StoredTaskRow>();
  readonly pushNotifications = new Map<string, string>();
  readonly migrations = new Map<number, string>();
  closeCount = 0;
  private transactionSnapshot: Map<string, StoredTaskRow> | undefined;
  private pushNotificationSnapshot: Map<string, string> | undefined;

  exec(sql: string): void {
    const normalizedSql = sql.trim();
    this.executedSql.push(normalizedSql);

    if (normalizedSql === 'BEGIN IMMEDIATE') {
      this.transactionSnapshot = new Map(
        [...this.tasks.entries()].map(([id, row]) => [id, { ...row }]),
      );
      this.pushNotificationSnapshot = new Map(this.pushNotifications);
      return;
    }

    if (normalizedSql === 'COMMIT') {
      this.transactionSnapshot = undefined;
      this.pushNotificationSnapshot = undefined;
      return;
    }

    if (normalizedSql === 'ROLLBACK') {
      if (this.transactionSnapshot) {
        this.tasks.clear();
        for (const [id, row] of this.transactionSnapshot) {
          this.tasks.set(id, { ...row });
        }
      }
      if (this.pushNotificationSnapshot) {
        this.pushNotifications.clear();
        for (const [id, configJson] of this.pushNotificationSnapshot) {
          this.pushNotifications.set(id, configJson);
        }
      }
      this.transactionSnapshot = undefined;
      this.pushNotificationSnapshot = undefined;
      return;
    }
  }

  prepare<TRow = unknown>(sql: string): FakeSqliteStatement<TRow> {
    return new FakeStatement<TRow>(this, sql);
  }

  close(): void {
    this.closeCount += 1;
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
      this.tasks.set(String(params[0]), {
        contextId: typeof params[1] === 'string' ? params[1] : null,
        taskJson: String(params[2]),
      });
      return { changes: 1 };
    }

    if (sql.startsWith('INSERT INTO push_notifications')) {
      this.pushNotifications.set(String(params[0]), String(params[1]));
      return { changes: 1 };
    }

    if (sql.startsWith('DELETE FROM push_notifications')) {
      if (params.length === 0) {
        const changes = this.pushNotifications.size;
        this.pushNotifications.clear();
        return { changes };
      }

      return { changes: this.pushNotifications.delete(String(params[0])) ? 1 : 0 };
    }

    if (sql === 'DELETE FROM tasks') {
      const changes = this.tasks.size;
      this.tasks.clear();
      return { changes };
    }

    if (sql.startsWith('DELETE FROM tasks WHERE id')) {
      return { changes: this.tasks.delete(String(params[0])) ? 1 : 0 };
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

    throw new Error(`Unexpected SQL run: ${sql}`);
  }

  get(sql: string, params: unknown[]): unknown {
    if (sql.startsWith('SELECT task_json FROM tasks WHERE id')) {
      const row = this.tasks.get(String(params[0]));
      return row ? ({ task_json: row.taskJson } satisfies FakeTaskJsonRow) : undefined;
    }

    if (sql.startsWith('SELECT config_json FROM push_notifications')) {
      const configJson = this.pushNotifications.get(String(params[0]));
      return configJson ? { config_json: configJson } : undefined;
    }

    if (sql.startsWith('SELECT COUNT(*) AS count FROM tasks')) {
      return { count: this.tasks.size };
    }

    throw new Error(`Unexpected SQL get: ${sql}`);
  }

  all(sql: string, params: unknown[]): unknown[] {
    if (sql.startsWith('SELECT task_json FROM tasks WHERE context_id')) {
      const contextId = String(params[0]);
      return [...this.tasks.values()]
        .filter((row) => row.contextId === contextId)
        .map((row) => ({ task_json: row.taskJson }) satisfies FakeTaskJsonRow);
    }

    if (sql.startsWith('SELECT task_json FROM tasks ORDER BY id')) {
      return [...this.tasks.values()].map(
        (row) => ({ task_json: row.taskJson }) satisfies FakeTaskJsonRow,
      );
    }

    throw new Error(`Unexpected SQL all: ${sql}`);
  }
}

class FakeStatement<TRow> implements FakeSqliteStatement<TRow> {
  constructor(
    private readonly database: FakeTransactionalDatabase,
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

function createTask(id: string): Task {
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
  };
}

describe('AsyncTaskStorage', () => {
  it('commits and rolls back SQLite transaction callbacks atomically', async () => {
    const FakeDatabaseConstructor = class extends FakeTransactionalDatabase {
      static readonly instances: FakeTransactionalDatabase[] = [];

      constructor(readonly path: string) {
        super();
        FakeDatabaseConstructor.instances.push(this);
      }
    };
    const storage = new AsyncSqliteTaskStorage(':memory:', FakeDatabaseConstructor);
    const database = FakeDatabaseConstructor.instances[0];
    if (!database) {
      throw new Error('Expected fake database to be constructed');
    }

    await storage.insertTask(createTask('task-1'));

    await storage.transaction(async (transaction) => {
      const task = await transaction.getTask('task-1');
      if (!task) {
        throw new Error('Expected task in transaction');
      }
      task.metadata = { committed: true };
      await transaction.saveTask(task);
    });

    expect((await storage.getTask('task-1'))?.metadata).toEqual({ committed: true });

    await expect(
      storage.transaction(async (transaction) => {
        const task = await transaction.getTask('task-1');
        if (!task) {
          throw new Error('Expected task in transaction');
        }
        task.metadata = { rolledBack: true };
        await transaction.saveTask(task);
        throw new Error('rollback requested');
      }),
    ).rejects.toThrow('rollback requested');

    expect((await storage.getTask('task-1'))?.metadata).toEqual({ committed: true });
    expect(database.executedSql).toContain('BEGIN IMMEDIATE');
    expect(database.executedSql).toContain('COMMIT');
    expect(database.executedSql).toContain('ROLLBACK');
  });

  it('supports async SQLite reads, notifications, deletion, clearing and close', async () => {
    const FakeDatabaseConstructor = class extends FakeTransactionalDatabase {
      static readonly instances: FakeTransactionalDatabase[] = [];

      constructor(readonly path: string) {
        super();
        FakeDatabaseConstructor.instances.push(this);
      }
    };
    const storage = new AsyncSqliteTaskStorage(':memory:', FakeDatabaseConstructor);
    const database = FakeDatabaseConstructor.instances[0];
    if (!database) {
      throw new Error('Expected fake database to be constructed');
    }
    const task = {
      ...createTask('task-ops'),
      contextId: 'context-ops',
    };

    const insertedTask = await storage.insertTask(task);
    expect(insertedTask).toEqual(task);
    expect(insertedTask).not.toBe(task);
    expect(await storage.count()).toBe(1);
    expect(await storage.getAllTasks()).toHaveLength(1);
    expect(await storage.getTasksByContextId('context-ops')).toEqual([task]);
    expect(
      await storage.setPushNotification('missing-task', { url: 'https://example.com/nope' }),
    ).toBeUndefined();

    const config = { url: 'https://example.com/hook', token: 'abc' };
    await expect(storage.setPushNotification(task.id, config)).resolves.toEqual(config);
    await expect(storage.getPushNotification(task.id)).resolves.toEqual(config);
    await expect(storage.deleteTask('missing-task')).resolves.toBe(false);
    await expect(storage.deleteTask(task.id)).resolves.toBe(true);
    await expect(storage.getTask(task.id)).resolves.toBeUndefined();
    await expect(storage.getPushNotification(task.id)).resolves.toBeUndefined();

    await storage.insertTask({ ...task, id: 'task-clear' });
    await storage.setPushNotification('task-clear', { url: 'https://example.com/clear' });
    await storage.clear();
    await expect(storage.getAllTasks()).resolves.toEqual([]);
    await expect(storage.count()).resolves.toBe(0);

    await storage.close();
    expect(database.closeCount).toBe(1);
  });
});
