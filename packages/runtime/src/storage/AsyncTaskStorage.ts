import type { ITaskStorage } from './ITaskStorage.js';
import { SerializedAsyncOperationQueue } from './SerializedAsyncOperationQueue.js';
import type { PushNotificationConfig, Task } from '../types/task.js';

export interface AsyncTaskStorageOperations {
  insertTask(task: Task): Promise<Task>;
  getTask(taskId: string): Promise<Task | undefined>;
  saveTask(task: Task): Promise<void>;
  getAllTasks(): Promise<Task[]>;
  getTasksByContextId(contextId: string): Promise<Task[]>;
  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined>;
  getPushNotification(taskId: string): Promise<PushNotificationConfig | undefined>;
  listPushNotifications?(taskId: string): Promise<PushNotificationConfig[]>;
  setPushNotificationConfig?(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined>;
  getPushNotificationConfig?(
    taskId: string,
    configId: string,
  ): Promise<PushNotificationConfig | undefined>;
  removePushNotificationConfig?(taskId: string, configId: string): Promise<boolean>;
  removePushNotification(taskId: string): Promise<boolean>;
  deleteTask(taskId: string): Promise<boolean>;
  clear(): Promise<void>;
  setTtl?(taskId: string, ttlMs: number): Promise<void>;
  count(): Promise<number>;
}

export type AsyncTaskStorageTransaction<T> = (
  storage: AsyncTaskStorageOperations,
) => T | Promise<T>;

export interface AsyncTaskStorage extends AsyncTaskStorageOperations {
  /**
   * Runs read/modify/write operations in one serialized storage transaction.
   *
   * Implementations should commit if the callback resolves and roll back if it throws or rejects.
   * Transaction callbacks should only await storage work that belongs to the transaction.
   */
  transaction?<T>(callback: AsyncTaskStorageTransaction<T>): Promise<T>;
}

export class SyncTaskStorageAdapter implements AsyncTaskStorage {
  private readonly operations = new SerializedAsyncOperationQueue();

  constructor(private readonly storage: ITaskStorage) {}

  insertTask(task: Task): Promise<Task> {
    return this.operations.run(() => this.storage.insertTask(task));
  }

  getTask(taskId: string): Promise<Task | undefined> {
    return this.operations.run(() => this.storage.getTask(taskId));
  }

  saveTask(task: Task): Promise<void> {
    return this.operations.run(() => this.storage.saveTask(task));
  }

  getAllTasks(): Promise<Task[]> {
    return this.operations.run(() => this.storage.getAllTasks());
  }

  getTasksByContextId(contextId: string): Promise<Task[]> {
    return this.operations.run(() => this.storage.getTasksByContextId(contextId));
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(() => this.storage.setPushNotification(taskId, config));
  }

  getPushNotification(taskId: string): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(() => this.storage.getPushNotification(taskId));
  }

  listPushNotifications(taskId: string): Promise<PushNotificationConfig[]> {
    return this.operations.run(() => this.storage.listPushNotifications?.(taskId) ?? []);
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(
      () =>
        this.storage.setPushNotificationConfig?.(taskId, configId, config) ??
        this.storage.setPushNotification(taskId, { ...config, id: configId }),
    );
  }

  getPushNotificationConfig(
    taskId: string,
    configId: string,
  ): Promise<PushNotificationConfig | undefined> {
    return this.operations.run(
      () =>
        this.storage.getPushNotificationConfig?.(taskId, configId) ??
        (configId === 'default' ? this.storage.getPushNotification(taskId) : undefined),
    );
  }

  removePushNotificationConfig(taskId: string, configId: string): Promise<boolean> {
    return this.operations.run(
      () =>
        this.storage.removePushNotificationConfig?.(taskId, configId) ??
        (configId === 'default' ? this.storage.removePushNotification(taskId) : false),
    );
  }

  removePushNotification(taskId: string): Promise<boolean> {
    return this.operations.run(() => this.storage.removePushNotification(taskId));
  }

  deleteTask(taskId: string): Promise<boolean> {
    return this.operations.run(() => this.storage.deleteTask(taskId));
  }

  clear(): Promise<void> {
    return this.operations.run(() => this.storage.clear());
  }

  setTtl(taskId: string, ttlMs: number): Promise<void> {
    return this.operations.run(() => this.storage.setTtl?.(taskId, ttlMs));
  }

  count(): Promise<number> {
    return this.operations.run(() => this.storage.count());
  }

  transaction<T>(callback: AsyncTaskStorageTransaction<T>): Promise<T> {
    return this.operations.runInScope(() => callback(this));
  }
}

export function adaptSyncTaskStorage(storage: ITaskStorage): AsyncTaskStorage {
  return new SyncTaskStorageAdapter(storage);
}
