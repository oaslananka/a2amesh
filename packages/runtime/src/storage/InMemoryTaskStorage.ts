import type { ITaskStorage } from './ITaskStorage.js';
import type { PushNotificationConfig, Task } from '../types/task.js';

export class InMemoryTaskStorage implements ITaskStorage {
  private readonly tasks = new Map<string, Task>();
  private readonly contextIndex = new Map<string, Set<string>>();
  private readonly pushNotifications = new Map<string, Map<string, PushNotificationConfig>>();
  private readonly ttlTimers = new Map<string, NodeJS.Timeout>();

  insertTask(task: Task): Task {
    const storedTask = structuredClone(task);
    this.tasks.set(storedTask.id, storedTask);
    this.syncContextIndex(undefined, storedTask.contextId, storedTask.id);
    return structuredClone(storedTask);
  }

  getTask(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  saveTask(task: Task): void {
    const previousTask = this.tasks.get(task.id);
    const storedTask = structuredClone(task);
    this.tasks.set(task.id, storedTask);
    this.syncContextIndex(previousTask?.contextId, storedTask.contextId, storedTask.id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values(), (task) => structuredClone(task));
  }

  getTasksByContextId(contextId: string): Task[] {
    const ids = this.contextIndex.get(contextId);
    if (!ids) {
      return [];
    }

    return Array.from(ids)
      .map((taskId) => this.tasks.get(taskId))
      .filter((task): task is Task => task !== undefined)
      .map((task) => structuredClone(task));
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    if (!this.tasks.has(taskId)) {
      return undefined;
    }

    return this.setPushNotificationConfig(taskId, pushNotificationConfigId(config), config);
  }

  getPushNotification(taskId: string): PushNotificationConfig | undefined {
    return this.getPushNotificationConfig(taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
  }

  listPushNotifications(taskId: string): PushNotificationConfig[] {
    return Array.from(this.pushNotifications.get(taskId)?.values() ?? [], (config) =>
      structuredClone(config),
    );
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    if (!this.tasks.has(taskId)) {
      return undefined;
    }

    const normalizedConfig = structuredClone(config);
    const taskConfigs =
      this.pushNotifications.get(taskId) ?? new Map<string, PushNotificationConfig>();
    taskConfigs.set(configId, normalizedConfig);
    this.pushNotifications.set(taskId, taskConfigs);
    return structuredClone(normalizedConfig);
  }

  getPushNotificationConfig(taskId: string, configId: string): PushNotificationConfig | undefined {
    const config = this.pushNotifications.get(taskId)?.get(configId);
    return config ? structuredClone(config) : undefined;
  }

  removePushNotificationConfig(taskId: string, configId: string): boolean {
    const taskConfigs = this.pushNotifications.get(taskId);
    if (!taskConfigs) {
      return false;
    }

    const removed = taskConfigs.delete(configId);
    if (taskConfigs.size === 0) {
      this.pushNotifications.delete(taskId);
    }
    return removed;
  }

  removePushNotification(taskId: string): boolean {
    return this.removePushNotificationConfig(taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
  }
  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    this.tasks.delete(taskId);
    this.pushNotifications.delete(taskId);
    this.clearTtl(taskId);
    this.syncContextIndex(task.contextId, undefined, taskId);
    return true;
  }

  clear(): void {
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer);
    }
    this.ttlTimers.clear();
    this.tasks.clear();
    this.contextIndex.clear();
    this.pushNotifications.clear();
  }

  setTtl(taskId: string, ttlMs: number): void {
    if (!this.tasks.has(taskId)) {
      return;
    }

    this.clearTtl(taskId);
    const timer = setTimeout(() => {
      this.deleteTask(taskId);
    }, ttlMs);
    timer.unref?.();
    this.ttlTimers.set(taskId, timer);
  }

  count(): number {
    return this.tasks.size;
  }

  private clearTtl(taskId: string): void {
    const timer = this.ttlTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(taskId);
    }
  }

  private syncContextIndex(
    previousContextId: string | undefined,
    nextContextId: string | undefined,
    taskId: string,
  ): void {
    if (previousContextId && previousContextId !== nextContextId) {
      const previousIds = this.contextIndex.get(previousContextId);
      previousIds?.delete(taskId);
      if (previousIds?.size === 0) {
        this.contextIndex.delete(previousContextId);
      }
    }

    if (!nextContextId) {
      return;
    }

    const nextIds = this.contextIndex.get(nextContextId) ?? new Set<string>();
    nextIds.add(taskId);
    this.contextIndex.set(nextContextId, nextIds);
  }
}

const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

function pushNotificationConfigId(config: PushNotificationConfig): string {
  return config.id && config.id.trim().length > 0
    ? config.id.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}
