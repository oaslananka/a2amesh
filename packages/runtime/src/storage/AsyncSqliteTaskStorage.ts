import type { AsyncTaskStorage, AsyncTaskStorageTransaction } from './AsyncTaskStorage.js';
import type { PushNotificationConfig, Task } from '../types/task.js';
import { SerializedAsyncOperationQueue } from './SerializedAsyncOperationQueue.js';
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

export class AsyncSqliteTaskStorage implements AsyncTaskStorage {
  private readonly context;
  private readonly operations = new SerializedAsyncOperationQueue();

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
  ) {
    this.context = createSqliteTaskStorageContext(path, databaseConstructorOrOptions);
  }

  insertTask(task: Task): Promise<Task> {
    return this.operations.run(() =>
      insertTaskIntoSqlite(this.context.db, task, this.context.taskOptions),
    );
  }

  getTask(taskId: string): Promise<Task | undefined> {
    return this.operations.run(() => getTaskFromSqlite(this.context.db, taskId));
  }

  saveTask(task: Task): Promise<void> {
    return this.operations.run(() =>
      saveTaskToSqlite(this.context.db, task, this.context.taskOptions),
    );
  }

  getAllTasks(): Promise<Task[]> {
    return this.operations.run(() => getAllTasksFromSqlite(this.context.db));
  }

  getTasksByContextId(contextId: string): Promise<Task[]> {
    return this.operations.run(() => getTasksByContextIdFromSqlite(this.context.db, contextId));
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(() => setPushNotificationInSqlite(this.context.db, taskId, config));
  }

  removePushNotification(taskId: string): Promise<boolean> {
    return this.operations.run(() => removePushNotificationFromSqlite(this.context.db, taskId));
  }

  getPushNotification(taskId: string): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(() => getPushNotificationFromSqlite(this.context.db, taskId));
  }

  listPushNotifications(taskId: string): Promise<PushNotificationConfig[]> {
    return this.operations.run(() => listPushNotificationsFromSqlite(this.context.db, taskId));
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(() =>
      setPushNotificationConfigInSqlite(this.context.db, taskId, configId, config),
    );
  }

  getPushNotificationConfig(
    taskId: string,
    configId: string,
  ): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(() =>
      getPushNotificationConfigFromSqlite(this.context.db, taskId, configId),
    );
  }

  removePushNotificationConfig(taskId: string, configId: string): Promise<boolean> {
    return this.operations.run(() =>
      removePushNotificationConfigFromSqlite(this.context.db, taskId, configId),
    );
  }

  deleteTask(taskId: string): Promise<boolean> {
    return this.operations.run(() =>
      deleteTaskFromSqlite(this.context.db, taskId, this.context.taskOptions),
    );
  }

  clear(): Promise<void> {
    return this.operations.run(() => clearSqliteTaskStorage(this.context.db));
  }

  count(): Promise<number> {
    return this.operations.run(() => countSqliteTasks(this.context.db));
  }

  setTtl(
    taskId: string,
    ttlMs: number,
    tenantId = this.context.options.defaultTenantId,
  ): Promise<void> {
    return this.operations.run(() =>
      setTaskTtl(this.context.db, taskId, tenantId, ttlMs, this.context.options.now),
    );
  }

  cleanupRetention(policy: TaskRetentionPolicy): Promise<TaskCleanupResult> {
    return this.operations.run(() =>
      cleanupRetainedTasks(this.context.db, policy, this.context.retentionOptions),
    );
  }

  appendAuditEntry(input: TaskAuditInput): Promise<TaskAuditEntry> {
    return this.operations.run(() =>
      appendAuditEntryToSqlite(this.context.db, input, this.context.options.now),
    );
  }

  listAuditEntries(tenantId: string, taskId?: string, limit?: number): Promise<TaskAuditEntry[]> {
    return this.operations.run(() =>
      listAuditEntriesFromSqlite(this.context.db, tenantId, taskId, limit),
    );
  }

  saveArtifact(artifact: PersistedTaskArtifact): Promise<PersistedTaskArtifact> {
    return this.operations.run(() =>
      saveArtifactToSqlite(this.context.db, artifact, this.context.artifactOptions),
    );
  }

  listArtifacts(tenantId: string, taskId: string): Promise<PersistedTaskArtifact[]> {
    return this.operations.run(() => listArtifactsFromSqlite(this.context.db, tenantId, taskId));
  }

  getOperationalState(): Promise<SqliteTaskStorageOperationalState> {
    return this.operations.run(() => getSqliteTaskStorageOperationalState(this.context.db));
  }

  explainRetentionQueryPlan(): Promise<string[]> {
    return this.operations.run(() => explainRetentionQueryPlan(this.context.db));
  }

  transaction<T>(callback: AsyncTaskStorageTransaction<T>): Promise<T> {
    return this.operations.runInScope(async () => {
      this.context.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback(this);
        this.context.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.context.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.operations.run(() => this.context.db.close?.());
  }
}
