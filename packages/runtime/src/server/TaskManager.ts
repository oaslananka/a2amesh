/**
 * @file TaskManager.ts
 * Task lifecycle manager backed by a pluggable storage engine.
 */

import { EventEmitter } from 'node:events';
import { InMemoryTaskStorage } from '../storage/InMemoryTaskStorage.js';
import type { ITaskStorage } from '../storage/ITaskStorage.js';
import type {
  ExtensibleArtifact,
  Message,
  PushNotificationConfig,
  Task,
  TaskCounts,
  TaskState,
  TaskStateInput,
} from '../types/task.js';
import {
  appendArtifactToTask,
  appendHistoryMessageToTask,
  applyTaskStateToTask,
  assertTaskMutable,
  calculateTaskCounts,
  createSubmittedTask,
  type TaskUpdatedEvent,
  type TaskUpdateReason,
} from './taskLifecycle.js';

export { TaskLifecycleError } from './taskLifecycle.js';
export type {
  TaskLifecycleErrorCode,
  TaskUpdatedEvent,
  TaskUpdateReason,
} from './taskLifecycle.js';

export class TaskManager extends EventEmitter {
  constructor(private readonly storage: ITaskStorage = new InMemoryTaskStorage()) {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Creates a new task and stores it in memory.
   *
   * @param sessionId Optional session identifier.
   * @param contextId Optional conversation context identifier.
   * @returns Newly created task.
   */
  createTask(
    sessionId?: string,
    contextId?: string,
    principalId?: string,
    tenantId?: string,
  ): Task {
    const task = createSubmittedTask(sessionId, contextId, principalId, tenantId);
    const storedTask = this.storage.insertTask(task);
    this.emitTaskUpdated(storedTask, 'created');
    return storedTask;
  }

  getTask(taskId: string): Task | undefined {
    return this.storage.getTask(taskId);
  }

  getAllTasks(): Task[] {
    return this.storage.getAllTasks();
  }

  getTasksByContext(contextId: string): Task[] {
    return this.storage.getTasksByContextId(contextId);
  }

  getTasksByContextId(contextId: string): Task[] {
    return this.getTasksByContext(contextId);
  }

  addHistoryMessage(taskId: string, message: Message): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }

    appendHistoryMessageToTask(task, message);
    this.storage.saveTask(task);
    this.emitTaskUpdated(task, 'message');
    return task;
  }

  addArtifact(taskId: string, artifact: ExtensibleArtifact): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }

    appendArtifactToTask(task, artifact);
    this.storage.saveTask(task);
    this.emitTaskUpdated(task, 'artifact');
    return task;
  }

  updateTaskState(
    taskId: string,
    state: TaskStateInput,
    historyMessage?: Message,
    metadata?: Record<string, unknown>,
  ): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }

    const previousState = applyTaskStateToTask(task, state, historyMessage, metadata);
    this.storage.saveTask(task);
    this.emitTaskUpdated(task, 'state', previousState);
    return task;
  }

  cancelTask(taskId: string): Task | undefined {
    return this.updateTaskState(taskId, 'CANCELED');
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    assertTaskMutable(task, 'set push notification');

    return this.setPushNotificationConfig(taskId, pushNotificationConfigId(config), config);
  }

  getPushNotification(taskId: string): PushNotificationConfig | undefined {
    return this.getPushNotificationConfig(taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
  }

  listPushNotifications(taskId: string): PushNotificationConfig[] {
    return this.storage.listPushNotifications?.(taskId) ?? [];
  }

  setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    assertTaskMutable(task, 'set push notification');

    const storedConfig =
      this.storage.setPushNotificationConfig?.(taskId, configId, config) ??
      this.storage.setPushNotification(taskId, { ...config, id: configId });
    this.emitTaskUpdated(task, 'push-config');
    return storedConfig;
  }

  getPushNotificationConfig(taskId: string, configId: string): PushNotificationConfig | undefined {
    return (
      this.storage.getPushNotificationConfig?.(taskId, configId) ??
      (configId === DEFAULT_PUSH_NOTIFICATION_CONFIG_ID
        ? this.storage.getPushNotification(taskId)
        : undefined)
    );
  }

  removePushNotificationConfig(taskId: string, configId: string): boolean {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return false;
    }
    assertTaskMutable(task, 'remove push notification');

    const removed =
      this.storage.removePushNotificationConfig?.(taskId, configId) ??
      (configId === DEFAULT_PUSH_NOTIFICATION_CONFIG_ID
        ? this.storage.removePushNotification(taskId)
        : false);
    if (removed) {
      this.emitTaskUpdated(task, 'push-config');
    }
    return removed;
  }

  removePushNotification(taskId: string): boolean {
    return this.removePushNotificationConfig(taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
  }
  setTaskExtensions(taskId: string, extensions: string[]): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    assertTaskMutable(task, 'set extensions');

    task.extensions = extensions;
    this.storage.saveTask(task);
    return task;
  }

  getTaskCounts(): TaskCounts {
    return calculateTaskCounts(this.storage.getAllTasks());
  }

  private emitTaskUpdated(task: Task, reason: TaskUpdateReason, previousState?: TaskState): void {
    this.emit('taskUpdated', {
      task: structuredClone(task),
      reason,
      ...(previousState ? { previousState } : {}),
    } satisfies TaskUpdatedEvent);
  }
}

const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

function pushNotificationConfigId(config: PushNotificationConfig): string {
  return config.id && config.id.trim().length > 0
    ? config.id.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}
