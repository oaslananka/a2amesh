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

interface TaskRow {
  task_json: string;
  tenant_id?: string;
  status?: string;
  updated_at?: string;
  expires_at?: string | null;
}

interface PushNotificationRow {
  config_json: string;
}

interface PushNotificationCollection {
  configs: Record<string, PushNotificationConfig>;
}

interface CountRow {
  count: number;
}

interface PragmaValueRow {
  journal_mode?: string;
  timeout?: number;
}

interface IndexRow {
  name: string;
}

interface AuditRow {
  sequence: number;
  task_id: string;
  tenant_id: string;
  principal_id: string | null;
  action: string;
  outcome: TaskAuditEntry['outcome'];
  timestamp: string;
  correlation_id: string | null;
}

interface ArtifactRow {
  task_id: string;
  artifact_id: string;
  tenant_id: string;
  content_type: string;
  checksum_sha256: string;
  payload_ref: string;
  size_bytes: number | null;
  sensitivity: PersistedTaskArtifact['sensitivity'];
  redacted: number;
  provenance_json: string;
  created_at: string;
}

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

function insertTaskIntoSqlite(
  db: SqliteDatabase,
  task: Task,
  options: NormalizedSqliteTaskStorageOptions,
): Task {
  const tenantId = taskTenantId(task, options.defaultTenantId);
  const updatedAt = task.status.timestamp ?? options.now().toISOString();
  db.prepare(
    'INSERT INTO tasks (id, context_id, task_json, tenant_id, status, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    task.id,
    task.contextId ?? null,
    JSON.stringify(task),
    tenantId,
    task.status.state,
    updatedAt,
    null,
  );
  appendTaskAuditFromTask(db, task, tenantId, 'task.created', 'success', options.now);
  return structuredClone(task);
}

function getTaskFromSqlite(db: SqliteDatabase, taskId: string): Task | undefined {
  return parseTask(db.prepare<TaskRow>('SELECT task_json FROM tasks WHERE id = ?').get(taskId));
}

function saveTaskToSqlite(
  db: SqliteDatabase,
  task: Task,
  options: NormalizedSqliteTaskStorageOptions,
): void {
  const previous = db
    .prepare<TaskRow>('SELECT task_json, status FROM tasks WHERE id = ?')
    .get(task.id);
  const tenantId = taskTenantId(task, options.defaultTenantId);
  const updatedAt = task.status.timestamp ?? options.now().toISOString();
  db.prepare(
    'UPDATE tasks SET context_id = ?, task_json = ?, tenant_id = ?, status = ?, updated_at = ? WHERE id = ?',
  ).run(
    task.contextId ?? null,
    JSON.stringify(task),
    tenantId,
    task.status.state,
    updatedAt,
    task.id,
  );
  if (previous) {
    const previousTask = parseTask(previous);
    const action =
      previousTask?.status.state === task.status.state
        ? 'task.saved'
        : `task.transition.${previousTask?.status.state ?? 'UNKNOWN'}.${task.status.state}`;
    appendTaskAuditFromTask(db, task, tenantId, action, 'success', options.now);
  }
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
function deleteTaskFromSqlite(
  db: SqliteDatabase,
  taskId: string,
  options: NormalizedSqliteTaskStorageOptions,
): boolean {
  const task = getTaskFromSqlite(db, taskId);
  db.prepare('DELETE FROM push_notifications WHERE task_id = ?').run(taskId);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  const deleted = getSqliteChanges(result) > 0;
  if (deleted && task) {
    appendTaskAuditFromTask(
      db,
      task,
      taskTenantId(task, options.defaultTenantId),
      'task.deleted',
      'success',
      options.now,
    );
  }
  return deleted;
}

function clearSqliteTaskStorage(db: SqliteDatabase): void {
  db.prepare('DELETE FROM push_notifications').run();
  db.prepare('DELETE FROM tasks').run();
}

function countSqliteTasks(db: SqliteDatabase): number {
  const row = db.prepare<CountRow>('SELECT COUNT(*) AS count FROM tasks').get();
  return row?.count ?? 0;
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

function setTaskTtl(
  db: SqliteDatabase,
  taskId: string,
  tenantId: string,
  ttlMs: number,
  now: () => Date,
): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
    throw new Error('ttlMs must be a non-negative integer');
  }
  db.prepare('UPDATE tasks SET expires_at = ? WHERE id = ? AND tenant_id = ?').run(
    new Date(now().getTime() + ttlMs).toISOString(),
    taskId,
    tenantId,
  );
}

function cleanupRetainedTasks(
  db: SqliteDatabase,
  policy: TaskRetentionPolicy,
  now: () => Date,
): TaskCleanupResult {
  const evaluatedAt = (policy.now ?? now()).toISOString();
  const evaluatedMs = Date.parse(evaluatedAt);
  const rows = db
    .prepare<TaskRow>(
      'SELECT task_json, tenant_id, status, updated_at, expires_at FROM tasks WHERE tenant_id = ?',
    )
    .all(policy.tenantId);
  const eligible = rows.filter((row) => isRetentionEligible(row, policy, evaluatedMs));
  let deletedArtifacts = 0;
  let deletedTasks = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of eligible) {
      const task = parseTask(row);
      if (!task) continue;
      deletedArtifacts +=
        db
          .prepare<CountRow>(
            'SELECT COUNT(*) AS count FROM task_artifacts WHERE tenant_id = ? AND task_id = ?',
          )
          .get(policy.tenantId, task.id)?.count ?? 0;
      deletedTasks += getSqliteChanges(
        db
          .prepare('DELETE FROM tasks WHERE id = ? AND tenant_id = ?')
          .run(task.id, policy.tenantId),
      );
    }
    appendAuditEntry(
      db,
      {
        taskId: '*',
        tenantId: policy.tenantId,
        action: 'retention.cleanup',
        outcome: 'success',
        correlationId: `deleted-tasks:${deletedTasks};deleted-artifacts:${deletedArtifacts}`,
        timestamp: evaluatedAt,
      },
      now,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { tenantId: policy.tenantId, deletedTasks, deletedArtifacts, evaluatedAt };
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

function explainRetentionQueryPlan(db: SqliteDatabase): string[] {
  return db
    .prepare<{ detail: string }>(
      'EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE tenant_id = ? AND status = ? AND updated_at < ?',
    )
    .all('tenant', 'COMPLETED', '2100-01-01T00:00:00.000Z')
    .map((row) => row.detail);
}

export class SqliteTaskStorage implements ITaskStorage {
  private readonly db: SqliteDatabase;
  private readonly options: NormalizedSqliteTaskStorageOptions;

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
  ) {
    const normalized = normalizeSqliteOptions(databaseConstructorOrOptions);
    const Database = normalized.databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    this.options = normalized;
    initializeSqliteTaskStorage(this.db, normalized);
  }

  insertTask(task: Task): Task {
    return insertTaskIntoSqlite(this.db, task, this.options);
  }

  getTask(taskId: string): Task | undefined {
    return getTaskFromSqlite(this.db, taskId);
  }

  saveTask(task: Task): void {
    saveTaskToSqlite(this.db, task, this.options);
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
    return deleteTaskFromSqlite(this.db, taskId, this.options);
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
    return cleanupRetainedTasks(this.db, policy, this.options.now);
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
    initializeSqliteTaskStorage(this.db, normalized);
  }

  insertTask(task: Task): Promise<Task> {
    return this.runOperation(() => insertTaskIntoSqlite(this.db, task, this.options));
  }

  getTask(taskId: string): Promise<Task | undefined> {
    return this.runOperation(() => getTaskFromSqlite(this.db, taskId));
  }

  saveTask(task: Task): Promise<void> {
    return this.runOperation(() => saveTaskToSqlite(this.db, task, this.options));
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
    return this.runOperation(() => deleteTaskFromSqlite(this.db, taskId, this.options));
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
    return this.runOperation(() => cleanupRetainedTasks(this.db, policy, this.options.now));
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

function getSqliteChanges(result: unknown): number {
  if (result && typeof result === 'object' && 'changes' in result) {
    const changes = (result as { changes: unknown }).changes;
    return typeof changes === 'number' ? changes : 0;
  }
  return 0;
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

function taskTenantId(task: Task, fallback: string): string {
  const tenantId = task.metadata?.['tenantId'];
  if (typeof tenantId !== 'string' || !tenantId.trim()) return fallback;
  const normalized = tenantId.trim();
  if (normalized.length > 128) throw new Error('Task tenantId exceeds 128 characters');
  return normalized;
}

function safeMetadataString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().slice(0, 256);
  return /(?:bearer|password|secret|token)[\s:=]/i.test(normalized) ? '[REDACTED]' : normalized;
}

function mapAuditRow(row: AuditRow): TaskAuditEntry {
  return {
    sequence: row.sequence,
    taskId: row.task_id,
    tenantId: row.tenant_id,
    action: row.action,
    outcome: row.outcome,
    timestamp: row.timestamp,
    ...(row.principal_id ? { principalId: row.principal_id } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
  };
}

function mapArtifactRow(row: ArtifactRow): PersistedTaskArtifact {
  return {
    taskId: row.task_id,
    artifactId: row.artifact_id,
    tenantId: row.tenant_id,
    contentType: row.content_type,
    checksumSha256: row.checksum_sha256,
    payloadRef: row.payload_ref,
    sensitivity: row.sensitivity,
    redacted: row.redacted === 1,
    provenance: JSON.parse(row.provenance_json) as PersistedTaskArtifact['provenance'],
    createdAt: row.created_at,
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
  };
}

function isRetentionEligible(
  row: TaskRow,
  policy: TaskRetentionPolicy,
  evaluatedMs: number,
): boolean {
  const status = row.status ?? parseTask(row)?.status.state;
  if (!status || ['SUBMITTED', 'QUEUED', 'WORKING'].includes(status)) return false;
  if (row.expires_at && Date.parse(row.expires_at) <= evaluatedMs) return true;
  const ttlMs =
    status === 'COMPLETED'
      ? policy.completedTtlMs
      : status === 'FAILED'
        ? policy.failedTtlMs
        : status === 'CANCELED'
          ? policy.canceledTtlMs
          : status === 'REJECTED'
            ? policy.rejectedTtlMs
            : ['INPUT_REQUIRED', 'AUTH_REQUIRED', 'WAITING_ON_EXTERNAL'].includes(status)
              ? policy.stalePausedTtlMs
              : undefined;
  if (ttlMs === undefined || !Number.isSafeInteger(ttlMs) || ttlMs < 0) return false;
  const updatedMs = Date.parse(row.updated_at ?? parseTask(row)?.status.timestamp ?? '');
  return Number.isFinite(updatedMs) && updatedMs + ttlMs <= evaluatedMs;
}

const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

function pushNotificationConfigId(config: PushNotificationConfig): string {
  return config.id && config.id.trim().length > 0
    ? config.id.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}
