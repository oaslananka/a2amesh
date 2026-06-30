import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import type { AsyncTaskStorage, AsyncTaskStorageTransaction } from './AsyncTaskStorage.js';
import type { ITaskStorage } from './ITaskStorage.js';
import type { PushNotificationConfig, Task } from '../types/task.js';

interface SqliteStatement<TRow = unknown> {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): TRow | undefined;
  all(...params: unknown[]): TRow[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare<TRow = unknown>(sql: string): SqliteStatement<TRow>;
  close?(): void;
}

interface SqliteDatabaseConstructor {
  new (path: string): SqliteDatabase;
}

interface TaskRow {
  task_json: string;
}

interface PushNotificationRow {
  config_json: string;
}

interface PushNotificationCollection {
  configs: Record<string, PushNotificationConfig>;
}

function parseTask(row: TaskRow | undefined): Task | undefined {
  return row ? (JSON.parse(row.task_json) as Task) : undefined;
}

function parsePushNotification(
  row: PushNotificationRow | undefined,
): PushNotificationConfig | undefined {
  if (!row) {
    return undefined;
  }
  const configs = parsePushNotificationConfigs(row);
  return configs.get(DEFAULT_PUSH_NOTIFICATION_CONFIG_ID) ?? configs.values().next().value;
}

function parsePushNotificationConfigs(
  row: PushNotificationRow | undefined,
): Map<string, PushNotificationConfig> {
  if (!row) {
    return new Map();
  }

  const parsed = JSON.parse(row.config_json) as PushNotificationConfig | PushNotificationCollection;
  if (isPushNotificationCollection(parsed)) {
    return new Map(
      Object.entries(parsed.configs).map(([id, config]) => [id, structuredClone(config)]),
    );
  }

  const id = pushNotificationConfigId(parsed);
  return new Map([[id, { ...parsed, id }]]);
}

function isPushNotificationCollection(value: unknown): value is PushNotificationCollection {
  return (
    value !== null &&
    typeof value === 'object' &&
    'configs' in value &&
    (value as PushNotificationCollection).configs !== null &&
    typeof (value as PushNotificationCollection).configs === 'object'
  );
}

function serializePushNotificationConfigs(configs: Map<string, PushNotificationConfig>): string {
  return JSON.stringify({
    configs: Object.fromEntries(configs),
  } satisfies PushNotificationCollection);
}

function initializeSqliteTaskStorage(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      context_id TEXT,
      task_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_notifications (
      task_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_context_id ON tasks(context_id);
  `);
}

function insertTaskIntoSqlite(db: SqliteDatabase, task: Task): Task {
  db.prepare('INSERT INTO tasks (id, context_id, task_json) VALUES (?, ?, ?)').run(
    task.id,
    task.contextId ?? null,
    JSON.stringify(task),
  );
  return structuredClone(task);
}

function getTaskFromSqlite(db: SqliteDatabase, taskId: string): Task | undefined {
  return parseTask(db.prepare<TaskRow>('SELECT task_json FROM tasks WHERE id = ?').get(taskId));
}

function saveTaskToSqlite(db: SqliteDatabase, task: Task): void {
  db.prepare('UPDATE tasks SET context_id = ?, task_json = ? WHERE id = ?').run(
    task.contextId ?? null,
    JSON.stringify(task),
    task.id,
  );
}

function getAllTasksFromSqlite(db: SqliteDatabase): Task[] {
  return db
    .prepare<TaskRow>('SELECT task_json FROM tasks ORDER BY id')
    .all()
    .map((row) => JSON.parse(row.task_json) as Task);
}

function getTasksByContextIdFromSqlite(db: SqliteDatabase, contextId: string): Task[] {
  return db
    .prepare<TaskRow>('SELECT task_json FROM tasks WHERE context_id = ? ORDER BY id')
    .all(contextId)
    .map((row) => JSON.parse(row.task_json) as Task);
}

function setPushNotificationInSqlite(
  db: SqliteDatabase,
  taskId: string,
  config: PushNotificationConfig,
): PushNotificationConfig | undefined {
  return setPushNotificationConfigInSqlite(db, taskId, pushNotificationConfigId(config), config);
}

function setPushNotificationConfigInSqlite(
  db: SqliteDatabase,
  taskId: string,
  configId: string,
  config: PushNotificationConfig,
): PushNotificationConfig | undefined {
  if (!getTaskFromSqlite(db, taskId)) {
    return undefined;
  }

  const configs = parsePushNotificationConfigs(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
  const storedConfig = structuredClone(config);
  configs.set(configId, storedConfig);

  db.prepare(
    'INSERT INTO push_notifications (task_id, config_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET config_json = excluded.config_json',
  ).run(taskId, serializePushNotificationConfigs(configs));

  return structuredClone(storedConfig);
}

function getPushNotificationFromSqlite(
  db: SqliteDatabase,
  taskId: string,
): PushNotificationConfig | undefined {
  return parsePushNotification(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
}

function listPushNotificationsFromSqlite(
  db: SqliteDatabase,
  taskId: string,
): PushNotificationConfig[] {
  const configs = parsePushNotificationConfigs(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
  return Array.from(configs.values(), (config) => structuredClone(config));
}

function getPushNotificationConfigFromSqlite(
  db: SqliteDatabase,
  taskId: string,
  configId: string,
): PushNotificationConfig | undefined {
  const configs = parsePushNotificationConfigs(
    db
      .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
      .get(taskId),
  );
  const config = configs.get(configId);
  return config ? structuredClone(config) : undefined;
}

function removePushNotificationConfigFromSqlite(
  db: SqliteDatabase,
  taskId: string,
  configId: string,
): boolean {
  const row = db
    .prepare<PushNotificationRow>('SELECT config_json FROM push_notifications WHERE task_id = ?')
    .get(taskId);
  const configs = parsePushNotificationConfigs(row);
  const removed = configs.delete(configId);
  if (!removed) {
    return false;
  }

  if (configs.size === 0) {
    db.prepare('DELETE FROM push_notifications WHERE task_id = ?').run(taskId);
  } else {
    db.prepare(
      'INSERT INTO push_notifications (task_id, config_json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET config_json = excluded.config_json',
    ).run(taskId, serializePushNotificationConfigs(configs));
  }
  return true;
}

function removePushNotificationFromSqlite(db: SqliteDatabase, taskId: string): boolean {
  return removePushNotificationConfigFromSqlite(db, taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
}
function deleteTaskFromSqlite(db: SqliteDatabase, taskId: string): boolean {
  db.prepare('DELETE FROM push_notifications WHERE task_id = ?').run(taskId);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  return getSqliteChanges(result) > 0;
}

function clearSqliteTaskStorage(db: SqliteDatabase): void {
  db.prepare('DELETE FROM push_notifications').run();
  db.prepare('DELETE FROM tasks').run();
}

function countSqliteTasks(db: SqliteDatabase): number {
  const row = db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM tasks').get();
  return row?.count ?? 0;
}

export class SqliteTaskStorage implements ITaskStorage {
  private readonly db: SqliteDatabase;

  constructor(path: string, databaseConstructor?: SqliteDatabaseConstructor) {
    const Database = databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    initializeSqliteTaskStorage(this.db);
  }

  insertTask(task: Task): Task {
    return insertTaskIntoSqlite(this.db, task);
  }

  getTask(taskId: string): Task | undefined {
    return getTaskFromSqlite(this.db, taskId);
  }

  saveTask(task: Task): void {
    saveTaskToSqlite(this.db, task);
  }

  getAllTasks(): Task[] {
    return getAllTasksFromSqlite(this.db);
  }

  getTasksByContextId(contextId: string): Task[] {
    return getTasksByContextIdFromSqlite(this.db, contextId);
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    return setPushNotificationInSqlite(this.db, taskId, config);
  }

  getPushNotification(taskId: string): PushNotificationConfig | undefined {
    return getPushNotificationFromSqlite(this.db, taskId);
  }

  listPushNotifications(taskId: string): PushNotificationConfig[] {
    return listPushNotificationsFromSqlite(this.db, taskId);
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    return setPushNotificationConfigInSqlite(this.db, taskId, configId, config);
  }

  getPushNotificationConfig(taskId: string, configId: string): PushNotificationConfig | undefined {
    return getPushNotificationConfigFromSqlite(this.db, taskId, configId);
  }

  removePushNotificationConfig(taskId: string, configId: string): boolean {
    return removePushNotificationConfigFromSqlite(this.db, taskId, configId);
  }

  removePushNotification(taskId: string): boolean {
    return removePushNotificationFromSqlite(this.db, taskId);
  }

  deleteTask(taskId: string): boolean {
    return deleteTaskFromSqlite(this.db, taskId);
  }

  clear(): void {
    clearSqliteTaskStorage(this.db);
  }

  count(): number {
    return countSqliteTasks(this.db);
  }

  close(): void {
    this.db.close?.();
  }
}

export class AsyncSqliteTaskStorage implements AsyncTaskStorage {
  private readonly db: SqliteDatabase;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly transactionScope = new AsyncLocalStorage<boolean>();

  constructor(path: string, databaseConstructor?: SqliteDatabaseConstructor) {
    const Database = databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    initializeSqliteTaskStorage(this.db);
  }

  insertTask(task: Task): Promise<Task> {
    return this.runOperation(() => insertTaskIntoSqlite(this.db, task));
  }

  getTask(taskId: string): Promise<Task | undefined> {
    return this.runOperation(() => getTaskFromSqlite(this.db, taskId));
  }

  saveTask(task: Task): Promise<void> {
    return this.runOperation(() => saveTaskToSqlite(this.db, task));
  }

  getAllTasks(): Promise<Task[]> {
    return this.runOperation(() => getAllTasksFromSqlite(this.db));
  }

  getTasksByContextId(contextId: string): Promise<Task[]> {
    return this.runOperation(() => getTasksByContextIdFromSqlite(this.db, contextId));
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.runOperation(() => setPushNotificationInSqlite(this.db, taskId, config));
  }

  removePushNotification(taskId: string): Promise<boolean> {
    return this.runOperation(() => removePushNotificationFromSqlite(this.db, taskId));
  }

  getPushNotification(taskId: string): Promise<PushNotificationConfig | undefined> {
    return this.runOperation(() => getPushNotificationFromSqlite(this.db, taskId));
  }

  listPushNotifications(taskId: string): Promise<PushNotificationConfig[]> {
    return this.runOperation(() => listPushNotificationsFromSqlite(this.db, taskId));
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.runOperation(() =>
      setPushNotificationConfigInSqlite(this.db, taskId, configId, config),
    );
  }

  getPushNotificationConfig(
    taskId: string,
    configId: string,
  ): Promise<PushNotificationConfig | undefined> {
    return this.runOperation(() => getPushNotificationConfigFromSqlite(this.db, taskId, configId));
  }

  removePushNotificationConfig(taskId: string, configId: string): Promise<boolean> {
    return this.runOperation(() =>
      removePushNotificationConfigFromSqlite(this.db, taskId, configId),
    );
  }

  deleteTask(taskId: string): Promise<boolean> {
    return this.runOperation(() => deleteTaskFromSqlite(this.db, taskId));
  }

  clear(): Promise<void> {
    return this.runOperation(() => clearSqliteTaskStorage(this.db));
  }

  count(): Promise<number> {
    return this.runOperation(() => countSqliteTasks(this.db));
  }

  transaction<T>(callback: AsyncTaskStorageTransaction<T>): Promise<T> {
    return this.runOperation(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await this.transactionScope.run(true, () => callback(this));
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.runOperation(() => this.db.close?.());
  }

  private runOperation<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.transactionScope.getStore()) {
      return Promise.resolve(operation());
    }

    const run = this.operationQueue.then(operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function loadSqliteDatabase(): SqliteDatabaseConstructor {
  const require = createRequire(import.meta.url);
  const imported = require('better-sqlite3') as
    | SqliteDatabaseConstructor
    | { default: SqliteDatabaseConstructor };
  return 'default' in imported ? imported.default : imported;
}

function getSqliteChanges(result: unknown): number {
  if (result && typeof result === 'object' && 'changes' in result) {
    const changes = (result as { changes: unknown }).changes;
    return typeof changes === 'number' ? changes : 0;
  }
  return 0;
}

const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

function pushNotificationConfigId(config: PushNotificationConfig): string {
  return config.id && config.id.trim().length > 0
    ? config.id.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}
