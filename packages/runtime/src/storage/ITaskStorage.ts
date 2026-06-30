import type { PushNotificationConfig, Task } from '../types/task.js';

export interface ITaskStorage {
  insertTask(task: Task): Task;
  getTask(taskId: string): Task | undefined;
  saveTask(task: Task): void;
  getAllTasks(): Task[];
  getTasksByContextId(contextId: string): Task[];
  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined;
  getPushNotification(taskId: string): PushNotificationConfig | undefined;
  listPushNotifications?(taskId: string): PushNotificationConfig[];
  setPushNotificationConfig?(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined;
  getPushNotificationConfig?(taskId: string, configId: string): PushNotificationConfig | undefined;
  removePushNotificationConfig?(taskId: string, configId: string): boolean;
  removePushNotification(taskId: string): boolean;
  deleteTask(taskId: string): boolean;
  clear(): void;
  setTtl?(taskId: string, ttlMs: number): void;
  count(): number;
}
