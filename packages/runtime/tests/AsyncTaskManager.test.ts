import { describe, expect, it } from 'vitest';
import { AsyncTaskManager } from '../src/server/AsyncTaskManager.js';
import {
  adaptSyncTaskStorage,
  SyncTaskStorageAdapter,
  type AsyncTaskStorage,
} from '../src/storage/AsyncTaskStorage.js';
import { InMemoryTaskStorage } from '../src/storage/InMemoryTaskStorage.js';
import type { Message, PushNotificationConfig, Task } from '../src/types/task.js';

class NonTransactionalAsyncStorage implements AsyncTaskStorage {
  private readonly storage = new InMemoryTaskStorage();

  async insertTask(task: Task): Promise<Task> {
    return this.storage.insertTask(task);
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.storage.getTask(taskId);
  }

  async saveTask(task: Task): Promise<void> {
    this.storage.saveTask(task);
  }

  async getAllTasks(): Promise<Task[]> {
    return this.storage.getAllTasks();
  }

  async getTasksByContextId(contextId: string): Promise<Task[]> {
    return this.storage.getTasksByContextId(contextId);
  }

  async setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig | undefined> {
    return this.storage.setPushNotification(taskId, config);
  }

  async getPushNotification(taskId: string): Promise<PushNotificationConfig | undefined> {
    return this.storage.getPushNotification(taskId);
  }

  async removePushNotification(taskId: string): Promise<boolean> {
    return this.storage.removePushNotification(taskId);
  }

  async deleteTask(taskId: string): Promise<boolean> {
    return this.storage.deleteTask(taskId);
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async setTtl(taskId: string, ttlMs: number): Promise<void> {
    this.storage.setTtl(taskId, ttlMs);
  }

  async count(): Promise<number> {
    return this.storage.count();
  }
}

function createMessage(index: number): Message {
  return {
    role: 'user',
    messageId: `message-${index}`,
    timestamp: new Date().toISOString(),
    parts: [{ type: 'text', text: `message ${index}` }],
  };
}

describe('AsyncTaskManager', () => {
  it('emits async lifecycle events while tracking artifacts, states and counts', async () => {
    const manager = new AsyncTaskManager();
    const events: Array<{
      task: Task;
      reason: string;
      previousState?: string;
    }> = [];
    manager.on('taskUpdated', (event) => events.push(event));

    const task = await manager.createTask('session-1', 'context-1', 'principal-1', 'tenant-1');
    await manager.addArtifact(task.id, {
      artifactId: 'artifact-1',
      parts: [{ type: 'text', text: 'hello back' }],
      index: 0,
      lastChunk: true,
    });
    await manager.updateTaskState(task.id, 'working', createMessage(100), {
      message: 'Processing started',
      jobId: 'job-1',
    });
    await manager.cancelTask(task.id);

    expect(await manager.getAllTasks()).toHaveLength(1);
    expect(await manager.getTasksByContext('context-1')).toHaveLength(1);
    expect(await manager.getTasksByContextId('context-1')).toHaveLength(1);
    expect(await manager.getTaskCounts()).toEqual({
      total: 1,
      active: 0,
      completed: 0,
      failed: 0,
      canceled: 1,
      rejected: 0,
      submitted: 0,
      queued: 0,
      inputRequired: 0,
      authRequired: 0,
      waitingOnExternal: 0,
      working: 0,
    });

    const storedTask = await manager.getTask(task.id);
    expect(storedTask).toEqual(
      expect.objectContaining({
        contextId: 'context-1',
        principalId: 'principal-1',
        tenantId: 'tenant-1',
      }),
    );
    expect(storedTask?.artifacts?.[0]).toEqual(
      expect.objectContaining({
        artifactId: 'artifact-1',
        metadata: expect.objectContaining({ contextId: 'context-1' }),
      }),
    );
    expect(storedTask?.history).toHaveLength(1);
    expect(storedTask?.status.state).toBe('CANCELED');
    expect(events.map((event) => event.reason)).toEqual(['created', 'artifact', 'state', 'state']);
    expect(events[2]?.previousState).toBe('SUBMITTED');
    expect(events[3]?.previousState).toBe('WORKING');
    expect(events[0]?.task).not.toBe(task);
  });

  it('preserves all history updates when async mutations run concurrently', async () => {
    const manager = new AsyncTaskManager(new SyncTaskStorageAdapter(new InMemoryTaskStorage()));
    const task = await manager.createTask('session-1', 'context-1');

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        manager.addHistoryMessage(task.id, createMessage(index)),
      ),
    );

    const storedTask = await manager.getTask(task.id);
    expect(storedTask?.history).toHaveLength(25);
    expect(new Set(storedTask?.history.map((message) => message.messageId)).size).toBe(25);
  });

  it('adapts existing synchronous task storage without changing stored task semantics', async () => {
    const syncStorage = new InMemoryTaskStorage();
    const storage = new SyncTaskStorageAdapter(syncStorage);
    const manager = new AsyncTaskManager(storage);

    const task = await manager.createTask(undefined, 'context-adapter');
    await manager.setTaskExtensions(task.id, ['urn:test:extension']);
    await manager.setPushNotification(task.id, { url: 'https://example.com/hook' });

    expect(await storage.count()).toBe(1);
    expect(await manager.getTasksByContextId('context-adapter')).toHaveLength(1);
    expect(syncStorage.getTask(task.id)?.extensions).toEqual(['urn:test:extension']);
    expect(await manager.getPushNotification(task.id)).toEqual({
      url: 'https://example.com/hook',
    });
  });

  it('exposes sync storage adapter helpers through the async storage contract', async () => {
    const storage = adaptSyncTaskStorage(new InMemoryTaskStorage());
    const task = await storage.insertTask({
      kind: 'task',
      id: 'adapter-task',
      contextId: 'context-adapter',
      status: {
        state: 'SUBMITTED',
        timestamp: new Date().toISOString(),
      },
      history: [],
      artifacts: [],
      metadata: {},
      extensions: [],
    });

    if (!storage.transaction) {
      throw new Error('Expected sync adapter to expose transactions');
    }

    await storage.transaction(async (transaction) => {
      const storedTask = await transaction.getTask(task.id);
      if (!storedTask) {
        throw new Error('Expected task in sync adapter transaction');
      }
      storedTask.extensions = ['urn:test:adapter'];
      await transaction.saveTask(storedTask);
    });

    await storage.setTtl?.(task.id, 60_000);
    expect(await storage.getAllTasks()).toHaveLength(1);
    expect(await storage.getTasksByContextId('context-adapter')).toHaveLength(1);
    expect((await storage.getTask(task.id))?.extensions).toEqual(['urn:test:adapter']);
    expect(await storage.deleteTask('missing-task')).toBe(false);
    expect(await storage.deleteTask(task.id)).toBe(true);
    expect(await storage.count()).toBe(0);

    await storage.clear();
    expect(await storage.getAllTasks()).toEqual([]);
  });

  it('serializes non-transactional storage mutations and returns undefined for missing tasks', async () => {
    const manager = new AsyncTaskManager(new NonTransactionalAsyncStorage());
    const events: unknown[] = [];
    manager.on('taskUpdated', (event) => events.push(event));
    const message = createMessage(200);
    const artifact = {
      artifactId: 'missing-artifact',
      parts: [{ type: 'text' as const, text: 'nope' }],
      index: 0,
      lastChunk: true,
    };

    await expect(manager.addHistoryMessage('missing', message)).resolves.toBeUndefined();
    await expect(manager.addArtifact('missing', artifact)).resolves.toBeUndefined();
    await expect(manager.updateTaskState('missing', 'failed')).resolves.toBeUndefined();
    await expect(manager.cancelTask('missing')).resolves.toBeUndefined();
    await expect(manager.setTaskExtensions('missing', ['urn:test'])).resolves.toBeUndefined();
    await expect(
      manager.setPushNotification('missing', { url: 'https://example.com/hook' }),
    ).resolves.toBeUndefined();
    await expect(manager.getPushNotification('missing')).resolves.toBeUndefined();
    expect(events).toEqual([]);

    const task = await manager.createTask();
    await Promise.all([
      manager.setTaskExtensions(task.id, ['urn:test:one']),
      manager.addHistoryMessage(task.id, createMessage(201)),
    ]);
    expect((await manager.getTask(task.id))?.history).toHaveLength(1);
  });

  it('supports async multi push notification config CRUD', async () => {
    const manager = new AsyncTaskManager(new SyncTaskStorageAdapter(new InMemoryTaskStorage()));
    const task = await manager.createTask();

    await expect(manager.listPushNotifications('missing')).resolves.toEqual([]);
    await expect(manager.removePushNotificationConfig(task.id, 'missing')).resolves.toBe(false);
    await expect(
      manager.setPushNotificationConfig(task.id, 'email', {
        url: 'https://example.com/email',
      }),
    ).resolves.toEqual({ url: 'https://example.com/email' });
    await expect(
      manager.setPushNotificationConfig(task.id, 'pager', {
        id: 'pager',
        url: 'https://example.com/pager',
      }),
    ).resolves.toEqual({ id: 'pager', url: 'https://example.com/pager' });
    await expect(manager.getPushNotificationConfig(task.id, 'email')).resolves.toEqual({
      url: 'https://example.com/email',
    });
    await expect(manager.listPushNotifications(task.id)).resolves.toEqual([
      { url: 'https://example.com/email' },
      { id: 'pager', url: 'https://example.com/pager' },
    ]);
    await expect(manager.removePushNotificationConfig(task.id, 'email')).resolves.toBe(true);
    await expect(manager.getPushNotificationConfig(task.id, 'email')).resolves.toBeUndefined();
  });
});
