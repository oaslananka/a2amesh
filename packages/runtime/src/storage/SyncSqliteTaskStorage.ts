import type { ITaskStorage } from './ITaskStorage.js';
import type { PushNotificationConfig, Task } from '../types/task.js';
import { clearSqliteTaskStorage, deleteTaskFromSqlite } from './SqliteTaskStorageLifecycle.js';
import { getSqliteTaskStorageOperationalState } from './SqliteTaskStorageOperationalState.js';
import { appendAuditEntryToSqlite, listAuditEntriesFromSqlite } from './SqliteTaskStorageAudit.js';
import { listArtifactsFromSqlite, saveArtifactToSqlite } from './SqliteTaskStorageArtifacts.js';
import {
  createSqliteTaskStorageContext,
  type SqliteTaskStorageOptions,
} from './SqliteTaskStorageContext.js';
import type { SqliteDatabaseConstructor } from './SqliteTaskStorageMigrations.js';
import {
  cleanupRetainedTasks,
  explainRetentionQueryPlan,
  setTaskTtl,
} from './SqliteTaskStorageRetention.js';
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
} from './SqliteTaskStorageTasks.js';
import type {
  PersistedTaskArtifact,
  SqliteTaskStorageOperationalState,
  TaskAuditEntry,
  TaskAuditInput,
  TaskCleanupResult,
  TaskRetentionPolicy,
} from './TaskStorageContracts.js';

export class SqliteTaskStorage implements ITaskStorage {
  private readonly context;

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
  ) {
    this.context = createSqliteTaskStorageContext(path, databaseConstructorOrOptions);
  }

  insertTask(task: Task): Task {
    return insertTaskIntoSqlite(this.context.db, task, this.context.taskOptions);
  }

  getTask(taskId: string): Task | undefined {
    return getTaskFromSqlite(this.context.db, taskId);
  }

  saveTask(task: Task): void {
    saveTaskToSqlite(this.context.db, task, this.context.taskOptions);
  }

  getAllTasks(): Task[] {
    return getAllTasksFromSqlite(this.context.db);
  }

  getTasksByContextId(contextId: string): Task[] {
    return getTasksByContextIdFromSqlite(this.context.db, contextId);
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    return setPushNotificationInSqlite(this.context.db, taskId, config);
  }

  getPushNotification(taskId: string): PushNotificationConfig | undefined {
    return getPushNotificationFromSqlite(this.context.db, taskId);
  }

  listPushNotifications(taskId: string): PushNotificationConfig[] {
    return listPushNotificationsFromSqlite(this.context.db, taskId);
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    return setPushNotificationConfigInSqlite(this.context.db, taskId, configId, config);
  }

  getPushNotificationConfig(taskId: string, configId: string): PushNotificationConfig | undefined {
    return getPushNotificationConfigFromSqlite(this.context.db, taskId, configId);
  }

  removePushNotificationConfig(taskId: string, configId: string): boolean {
    return removePushNotificationConfigFromSqlite(this.context.db, taskId, configId);
  }

  removePushNotification(taskId: string): boolean {
    return removePushNotificationFromSqlite(this.context.db, taskId);
  }

  deleteTask(taskId: string): boolean {
    return deleteTaskFromSqlite(this.context.db, taskId, this.context.taskOptions);
  }

  clear(): void {
    clearSqliteTaskStorage(this.context.db);
  }

  count(): number {
    return countSqliteTasks(this.context.db);
  }

  setTtl(taskId: string, ttlMs: number, tenantId = this.context.options.defaultTenantId): void {
    setTaskTtl(this.context.db, taskId, tenantId, ttlMs, this.context.options.now);
  }

  cleanupRetention(policy: TaskRetentionPolicy): TaskCleanupResult {
    return cleanupRetainedTasks(this.context.db, policy, this.context.retentionOptions);
  }

  appendAuditEntry(input: TaskAuditInput): TaskAuditEntry {
    return appendAuditEntryToSqlite(this.context.db, input, this.context.options.now);
  }

  listAuditEntries(tenantId: string, taskId?: string, limit?: number): TaskAuditEntry[] {
    return listAuditEntriesFromSqlite(this.context.db, tenantId, taskId, limit);
  }

  saveArtifact(artifact: PersistedTaskArtifact): PersistedTaskArtifact {
    return saveArtifactToSqlite(this.context.db, artifact, this.context.artifactOptions);
  }

  listArtifacts(tenantId: string, taskId: string): PersistedTaskArtifact[] {
    return listArtifactsFromSqlite(this.context.db, tenantId, taskId);
  }

  getOperationalState(): SqliteTaskStorageOperationalState {
    return getSqliteTaskStorageOperationalState(this.context.db);
  }

  explainRetentionQueryPlan(): string[] {
    return explainRetentionQueryPlan(this.context.db);
  }

  close(): void {
    this.context.db.close?.();
  }
}
