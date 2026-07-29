import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import type { AsyncTaskStorage, AsyncTaskStorageTransaction } from './AsyncTaskStorage.js';
import type { ITaskStorage } from './ITaskStorage.js';
import type { PushNotificationConfig, Task } from '../types/task.js';
import {
  getSqliteSchemaVersion,
  initializeSqliteTaskStorage,
  type SqliteDatabase,
  type SqliteDatabaseConstructor,
} from './SqliteTaskStorageMigrations.js';
import { clearSqliteTaskStorage, deleteTaskFromSqlite } from './SqliteTaskStorageLifecycle.js';
import {
  cleanupRetainedTasks,
  explainRetentionQueryPlan,
  setTaskTtl,
  type SqliteRetentionOperationOptions,
} from './SqliteTaskStorageRetention.js';
import {
  mapArtifactRow,
  mapAuditRow,
  type ArtifactRow,
  type AuditRow,
  type IndexRow,
  type PragmaValueRow,
} from './SqliteTaskStorageRecords.js';
import {
  getPushNotificationConfigFromSqlite,
  getPushNotificationFromSqlite,
  listPushNotificationsFromSqlite,
  removePushNotificationConfigFromSqlite,
  removePushNotificationFromSqlite,
  setPushNotificationConfigInSqlite,
  setPushNotificationInSqlite,
} from './SqliteTaskStoragePushNotifications.js';
import {
  countSqliteTasks,
  getAllTasksFromSqlite,
  getTaskFromSqlite,
  getTasksByContextIdFromSqlite,
  insertTaskIntoSqlite,
  saveTaskToSqlite,
  type SqliteTaskOperationOptions,
} from './SqliteTaskStorageTasks.js';
import {
  validatePersistedTaskArtifact,
  type PersistedTaskArtifact,
  type SqliteTaskStorageOperationalState,
  type TaskAuditEntry,
  type TaskAuditInput,
  type TaskCleanupResult,
  type TaskRetentionPolicy,
} from './TaskStorageContracts.js';

export type { SqliteDatabase, SqliteDatabaseConstructor } from './SqliteTaskStorageMigrations.js';

export interface SqliteTaskStorageOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
  busyTimeoutMs?: number | undefined;
  defaultTenantId?: string | undefined;
  now?: (() => Date) | undefined;
}

interface NormalizedSqliteTaskStorageOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
  busyTimeoutMs: number;
  defaultTenantId: string;
  now: () => Date;
}

function appendAuditEntry(
  db: SqliteDatabase,
  input: TaskAuditInput,
  now: () => Date,
): TaskAuditEntry {
  const timestamp = input.timestamp ?? now().toISOString();
  const result = db
    .prepare(
      'INSERT INTO task_audit_journal (task_id, tenant_id, principal_id, action, outcome, timestamp, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.taskId,
      input.tenantId,
      input.principalId ?? null,
      input.action,
      input.outcome,
      timestamp,
      input.correlationId ?? null,
    );
  return {
    sequence: getSqliteLastInsertRowId(result),
    taskId: input.taskId,
    tenantId: input.tenantId,
    action: input.action,
    outcome: input.outcome,
    timestamp,
    ...(input.principalId ? { principalId: input.principalId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

function appendTaskAuditFromTask(
  db: SqliteDatabase,
  task: Task,
  tenantId: string,
  action: string,
  outcome: TaskAuditEntry['outcome'],
  now: () => Date,
): TaskAuditEntry {
  const principalId = safeMetadataString(task.metadata?.['principalId']);
  const correlationId = safeMetadataString(task.metadata?.['correlationId']);
  return appendAuditEntry(
    db,
    {
      taskId: task.id,
      tenantId,
      action,
      outcome,
      ...(principalId ? { principalId } : {}),
      ...(correlationId ? { correlationId } : {}),
    },
    now,
  );
}

function listAuditEntries(
  db: SqliteDatabase,
  tenantId: string,
  taskId?: string,
  limit = 100,
): TaskAuditEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Audit limit must be between 1 and 1000');
  }
  const rows = taskId
    ? db
        .prepare<AuditRow>(
          'SELECT sequence, task_id, tenant_id, principal_id, action, outcome, timestamp, correlation_id FROM task_audit_journal WHERE tenant_id = ? AND task_id = ? ORDER BY sequence LIMIT ?',
        )
        .all(tenantId, taskId, limit)
    : db
        .prepare<AuditRow>(
          'SELECT sequence, task_id, tenant_id, principal_id, action, outcome, timestamp, correlation_id FROM task_audit_journal WHERE tenant_id = ? ORDER BY sequence LIMIT ?',
        )
        .all(tenantId, limit);
  return rows.map(mapAuditRow);
}

function saveArtifact(db: SqliteDatabase, value: PersistedTaskArtifact): PersistedTaskArtifact {
  const artifact = validatePersistedTaskArtifact(value);
  const task = db
    .prepare<{ tenant_id: string }>('SELECT tenant_id FROM tasks WHERE id = ?')
    .get(artifact.taskId);
  if (!task || task.tenant_id !== artifact.tenantId) {
    throw new Error('Artifact task does not exist in the requested tenant');
  }
  db.prepare(
    'INSERT INTO task_artifacts (task_id, artifact_id, tenant_id, content_type, checksum_sha256, payload_ref, size_bytes, sensitivity, redacted, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(task_id, artifact_id) DO UPDATE SET content_type = excluded.content_type, checksum_sha256 = excluded.checksum_sha256, payload_ref = excluded.payload_ref, size_bytes = excluded.size_bytes, sensitivity = excluded.sensitivity, redacted = excluded.redacted, provenance_json = excluded.provenance_json, created_at = excluded.created_at WHERE task_artifacts.tenant_id = excluded.tenant_id',
  ).run(
    artifact.taskId,
    artifact.artifactId,
    artifact.tenantId,
    artifact.contentType,
    artifact.checksumSha256.toLowerCase(),
    artifact.payloadRef,
    artifact.sizeBytes ?? null,
    artifact.sensitivity,
    artifact.redacted ? 1 : 0,
    JSON.stringify(artifact.provenance),
    artifact.createdAt,
  );
  return artifact;
}

function listArtifacts(
  db: SqliteDatabase,
  tenantId: string,
  taskId: string,
): PersistedTaskArtifact[] {
  return db
    .prepare<ArtifactRow>(
      'SELECT task_id, artifact_id, tenant_id, content_type, checksum_sha256, payload_ref, size_bytes, sensitivity, redacted, provenance_json, created_at FROM task_artifacts WHERE tenant_id = ? AND task_id = ? ORDER BY artifact_id',
    )
    .all(tenantId, taskId)
    .map(mapArtifactRow);
}

function operationalState(db: SqliteDatabase): SqliteTaskStorageOperationalState {
  const journalMode = db.prepare<PragmaValueRow>('PRAGMA journal_mode').get()?.journal_mode ?? '';
  const busyTimeoutMs = db.prepare<PragmaValueRow>('PRAGMA busy_timeout').get()?.timeout ?? 0;
  const indexes = db
    .prepare<IndexRow>('PRAGMA index_list(tasks)')
    .all()
    .map((row) => row.name)
    .sort();
  return { schemaVersion: getSqliteSchemaVersion(db), journalMode, busyTimeoutMs, indexes };
}

function createRetentionOperationOptions(
  db: SqliteDatabase,
  options: NormalizedSqliteTaskStorageOptions,
): SqliteRetentionOperationOptions {
  return {
    now: options.now,
    appendAuditEntry(input, now) {
      appendAuditEntry(db, input, now);
    },
  };
}

function createTaskOperationOptions(
  db: SqliteDatabase,
  options: NormalizedSqliteTaskStorageOptions,
): SqliteTaskOperationOptions {
  return {
    defaultTenantId: options.defaultTenantId,
    now: options.now,
    appendTaskAudit(task, tenantId, action, outcome, now) {
      appendTaskAuditFromTask(db, task, tenantId, action, outcome, now);
    },
  };
}

export class SqliteTaskStorage implements ITaskStorage {
  private readonly db: SqliteDatabase;
  private readonly options: NormalizedSqliteTaskStorageOptions;
  private readonly taskOptions: SqliteTaskOperationOptions;
  private readonly retentionOptions: SqliteRetentionOperationOptions;

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
  ) {
    const normalized = normalizeSqliteOptions(databaseConstructorOrOptions);
    const Database = normalized.databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    this.options = normalized;
    this.taskOptions = createTaskOperationOptions(this.db, normalized);
    this.retentionOptions = createRetentionOperationOptions(this.db, normalized);
    initializeSqliteTaskStorage(this.db, normalized);
  }

  insertTask(task: Task): Task {
    return insertTaskIntoSqlite(this.db, task, this.taskOptions);
  }

  getTask(taskId: string): Task | undefined {
    return getTaskFromSqlite(this.db, taskId);
  }

  saveTask(task: Task): void {
    saveTaskToSqlite(this.db, task, this.taskOptions);
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
    return deleteTaskFromSqlite(this.db, taskId, this.taskOptions);
  }

  clear(): void {
    clearSqliteTaskStorage(this.db);
  }

  count(): number {
    return countSqliteTasks(this.db);
  }

  setTtl(taskId: string, ttlMs: number, tenantId = this.options.defaultTenantId): void {
    setTaskTtl(this.db, taskId, tenantId, ttlMs, this.options.now);
  }

  cleanupRetention(policy: TaskRetentionPolicy): TaskCleanupResult {
    return cleanupRetainedTasks(this.db, policy, this.retentionOptions);
  }

  appendAuditEntry(input: TaskAuditInput): TaskAuditEntry {
    return appendAuditEntry(this.db, input, this.options.now);
  }

  listAuditEntries(tenantId: string, taskId?: string, limit?: number): TaskAuditEntry[] {
    return listAuditEntries(this.db, tenantId, taskId, limit);
  }

  saveArtifact(artifact: PersistedTaskArtifact): PersistedTaskArtifact {
    const stored = saveArtifact(this.db, artifact);
    appendAuditEntry(
      this.db,
      {
        taskId: stored.taskId,
        tenantId: stored.tenantId,
        action: 'artifact.persisted',
        outcome: 'success',
      },
      this.options.now,
    );
    return stored;
  }

  listArtifacts(tenantId: string, taskId: string): PersistedTaskArtifact[] {
    return listArtifacts(this.db, tenantId, taskId);
  }

  getOperationalState(): SqliteTaskStorageOperationalState {
    return operationalState(this.db);
  }

  explainRetentionQueryPlan(): string[] {
    return explainRetentionQueryPlan(this.db);
  }

  close(): void {
    this.db.close?.();
  }
}

export class AsyncSqliteTaskStorage implements AsyncTaskStorage {
  private readonly db: SqliteDatabase;
  private readonly options: NormalizedSqliteTaskStorageOptions;
  private readonly taskOptions: SqliteTaskOperationOptions;
  private readonly retentionOptions: SqliteRetentionOperationOptions;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly transactionScope = new AsyncLocalStorage<boolean>();

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
  ) {
    const normalized = normalizeSqliteOptions(databaseConstructorOrOptions);
    const Database = normalized.databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    this.options = normalized;
    this.taskOptions = createTaskOperationOptions(this.db, normalized);
    this.retentionOptions = createRetentionOperationOptions(this.db, normalized);
    initializeSqliteTaskStorage(this.db, normalized);
  }

  insertTask(task: Task): Promise<Task> {
    return this.runOperation(() => insertTaskIntoSqlite(this.db, task, this.taskOptions));
  }

  getTask(taskId: string): Promise<Task | undefined> {
    return this.runOperation(() => getTaskFromSqlite(this.db, taskId));
  }

  saveTask(task: Task): Promise<void> {
    return this.runOperation(() => saveTaskToSqlite(this.db, task, this.taskOptions));
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
    return this.runOperation(() => deleteTaskFromSqlite(this.db, taskId, this.taskOptions));
  }

  clear(): Promise<void> {
    return this.runOperation(() => clearSqliteTaskStorage(this.db));
  }

  count(): Promise<number> {
    return this.runOperation(() => countSqliteTasks(this.db));
  }

  setTtl(taskId: string, ttlMs: number, tenantId = this.options.defaultTenantId): Promise<void> {
    return this.runOperation(() => setTaskTtl(this.db, taskId, tenantId, ttlMs, this.options.now));
  }

  cleanupRetention(policy: TaskRetentionPolicy): Promise<TaskCleanupResult> {
    return this.runOperation(() => cleanupRetainedTasks(this.db, policy, this.retentionOptions));
  }

  appendAuditEntry(input: TaskAuditInput): Promise<TaskAuditEntry> {
    return this.runOperation(() => appendAuditEntry(this.db, input, this.options.now));
  }

  listAuditEntries(tenantId: string, taskId?: string, limit?: number): Promise<TaskAuditEntry[]> {
    return this.runOperation(() => listAuditEntries(this.db, tenantId, taskId, limit));
  }

  saveArtifact(artifact: PersistedTaskArtifact): Promise<PersistedTaskArtifact> {
    return this.runOperation(() => {
      const stored = saveArtifact(this.db, artifact);
      appendAuditEntry(
        this.db,
        {
          taskId: stored.taskId,
          tenantId: stored.tenantId,
          action: 'artifact.persisted',
          outcome: 'success',
        },
        this.options.now,
      );
      return stored;
    });
  }

  listArtifacts(tenantId: string, taskId: string): Promise<PersistedTaskArtifact[]> {
    return this.runOperation(() => listArtifacts(this.db, tenantId, taskId));
  }

  getOperationalState(): Promise<SqliteTaskStorageOperationalState> {
    return this.runOperation(() => operationalState(this.db));
  }

  explainRetentionQueryPlan(): Promise<string[]> {
    return this.runOperation(() => explainRetentionQueryPlan(this.db));
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
  return DatabaseSync as unknown as SqliteDatabaseConstructor;
}

function getSqliteLastInsertRowId(result: unknown): number {
  if (result && typeof result === 'object' && 'lastInsertRowid' in result) {
    const value = (result as { lastInsertRowid: unknown }).lastInsertRowid;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return value;
  }
  return 0;
}

function normalizeSqliteOptions(
  input?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
): NormalizedSqliteTaskStorageOptions {
  const options = typeof input === 'function' ? { databaseConstructor: input } : (input ?? {});
  const defaultTenantId = options.defaultTenantId?.trim() || 'default';
  return {
    databaseConstructor: options.databaseConstructor,
    busyTimeoutMs: options.busyTimeoutMs ?? 5_000,
    defaultTenantId,
    now: options.now ?? (() => new Date()),
  };
}

function safeMetadataString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().slice(0, 256);
  return /(?:bearer|password|secret|token)[\s:=]/i.test(normalized) ? '[REDACTED]' : normalized;
}
