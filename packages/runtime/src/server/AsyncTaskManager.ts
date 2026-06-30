/**
 * @file AsyncTaskManager.ts
 * Async task lifecycle manager backed by an AsyncTaskStorage implementation.
 */

import { EventEmitter } from 'node:events';
import { InMemoryTaskStorage } from '../storage/InMemoryTaskStorage.js';
import {
  SyncTaskStorageAdapter,
  type AsyncTaskStorage,
  type AsyncTaskStorageOperations,
} from '../storage/AsyncTaskStorage.js';
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

interface MutationOutcome<T> {
  result: T;
  event?: TaskUpdatedEvent;
}

export class AsyncTaskManager extends EventEmitter {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: AsyncTaskStorage = new SyncTaskStorageAdapter(
      new InMemoryTaskStorage(),
    ),
  ) {
    super();
    this.setMaxListeners(100);
  }

  async createTask(
    sessionId?: string,
    contextId?: string,
    principalId?: string,
    tenantId?: string,
  ): Promise<Task> {
    const task = createSubmittedTask(sessionId, contextId, principalId, tenantId);
    const storedTask = await this.runStorageMutation((storage) => storage.insertTask(task));
    this.emitTaskUpdated(storedTask, 'created');
    return storedTask;
  }

  getTask(taskId: string): Promise<Task | undefined> {
    return this.storage.getTask(taskId);
  }

  getAllTasks(): Promise<Task[]> {
    return this.storage.getAllTasks();
  }

  getTasksByContext(contextId: string): Promise<Task[]> {
    return this.storage.getTasksByContextId(contextId);
  }

  getTasksByContextId(contextId: string): Promise<Task[]> {
    return this.getTasksByContext(contextId);
  }

  async addHistoryMessage(taskId: string, message: Message): Promise<Task | undefined> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: undefined };
      }

      appendHistoryMessageToTask(task, message);
      await storage.saveTask(task);
      return {
        result: task,
        event: { task, reason: 'message' },
      };
    });
  }

  async addArtifact(taskId: string, artifact: ExtensibleArtifact): Promise<Task | undefined> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: undefined };
      }

      appendArtifactToTask(task, artifact);
      await storage.saveTask(task);
      return {
        result: task,
        event: { task, reason: 'artifact' },
      };
    });
  }

  async updateTaskState(
    taskId: string,
    state: TaskStateInput,
    historyMessage?: Message,
    metadata?: Record<string, unknown>,
  ): Promise<Task | undefined> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: undefined };
      }

      const previousState = applyTaskStateToTask(task, state, historyMessage, metadata);
      await storage.saveTask(task);
      return {
        result: task,
        event: { task, reason: 'state', previousState },
      };
    });
  }

  cancelTask(taskId: string): Promise<Task | undefined> {
    return this.updateTaskState(taskId, 'CANCELED');
  }

  async setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: undefined };
      }
      assertTaskMutable(task, 'set push notification');

      const configId = pushNotificationConfigId(config);
      const storedConfig =
        (await storage.setPushNotificationConfig?.(taskId, configId, config)) ??
        (await storage.setPushNotification(taskId, { ...config, id: configId }));
      return {
        result: storedConfig,
        ...(storedConfig ? { event: { task, reason: 'push-config' } } : {}),
      };
    });
  }

  getPushNotification(taskId: string): Promise<PushNotificationConfig | undefined> {
    return this.getPushNotificationConfig(taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
  }

  async listPushNotifications(taskId: string): Promise<PushNotificationConfig[]> {
    return this.storage.listPushNotifications?.(taskId) ?? [];
  }

  async setPushNotificationConfig(
    taskId: string,
    configId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: undefined };
      }
      assertTaskMutable(task, 'set push notification');

      const storedConfig =
        (await storage.setPushNotificationConfig?.(taskId, configId, config)) ??
        (await storage.setPushNotification(taskId, { ...config, id: configId }));
      return {
        result: storedConfig,
        ...(storedConfig ? { event: { task, reason: 'push-config' } } : {}),
      };
    });
  }

  async getPushNotificationConfig(
    taskId: string,
    configId: string,
  ): Promise<PushNotificationConfig | undefined> {
    return (
      (await this.storage.getPushNotificationConfig?.(taskId, configId)) ??
      (configId === DEFAULT_PUSH_NOTIFICATION_CONFIG_ID
        ? await this.storage.getPushNotification(taskId)
        : undefined)
    );
  }

  async removePushNotificationConfig(taskId: string, configId: string): Promise<boolean> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: false };
      }
      assertTaskMutable(task, 'remove push notification');

      const removed =
        (await storage.removePushNotificationConfig?.(taskId, configId)) ??
        (configId === DEFAULT_PUSH_NOTIFICATION_CONFIG_ID
          ? await storage.removePushNotification(taskId)
          : false);
      return {
        result: removed,
        ...(removed ? { event: { task, reason: 'push-config' } } : {}),
      };
    });
  }

  removePushNotification(taskId: string): Promise<boolean> {
    return this.removePushNotificationConfig(taskId, DEFAULT_PUSH_NOTIFICATION_CONFIG_ID);
  }

  async setTaskExtensions(taskId: string, extensions: string[]): Promise<Task | undefined> {
    return this.runTaskMutation(async (storage) => {
      const task = await storage.getTask(taskId);
      if (!task) {
        return { result: undefined };
      }
      assertTaskMutable(task, 'set extensions');

      task.extensions = extensions;
      await storage.saveTask(task);
      return { result: task };
    });
  }

  async getTaskCounts(): Promise<TaskCounts> {
    return calculateTaskCounts(await this.storage.getAllTasks());
  }

  private async runTaskMutation<T>(
    operation: (storage: AsyncTaskStorageOperations) => Promise<MutationOutcome<T>>,
  ): Promise<T> {
    const outcome = await this.runStorageMutation(operation);
    if (outcome.event) {
      this.emitTaskUpdated(outcome.event.task, outcome.event.reason, outcome.event.previousState);
    }
    return outcome.result;
  }

  private runStorageMutation<T>(
    operation: (storage: AsyncTaskStorageOperations) => Promise<T>,
  ): Promise<T> {
    if (this.storage.transaction) {
      return this.storage.transaction(operation);
    }

    const run = this.mutationQueue.then(() => operation(this.storage));
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
