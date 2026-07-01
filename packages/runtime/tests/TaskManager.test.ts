import { describe, expect, it } from 'vitest';
import { TaskLifecycleError, TaskManager } from '../src/server/TaskManager.js';

describe('TaskManager', () => {
  it('uses A2A v1.0 task state constants while accepting legacy transition inputs', () => {
    const manager = new TaskManager();
    const task = manager.createTask();

    expect(task.status.state).toBe('SUBMITTED');

    manager.updateTaskState(task.id, 'working');
    expect(manager.getTask(task.id)?.status.state).toBe('WORKING');

    manager.updateTaskState(task.id, 'waiting-on-external');
    expect(manager.getTask(task.id)?.status.state).toBe('WAITING_ON_EXTERNAL');

    const authTask = manager.createTask();
    manager.updateTaskState(authTask.id, 'TASK_STATE_AUTH_REQUIRED');
    expect(manager.getTask(authTask.id)?.status.state).toBe('AUTH_REQUIRED');
    expect(manager.getTask(authTask.id)?.metadata).toEqual(
      expect.objectContaining({ authRequiredAt: expect.any(String) }),
    );

    const rejectedTask = manager.createTask();
    manager.updateTaskState(rejectedTask.id, 'TASK_STATE_REJECTED');
    expect(manager.getTask(rejectedTask.id)?.status.state).toBe('REJECTED');
    expect(manager.getTask(rejectedTask.id)?.metadata).toEqual(
      expect.objectContaining({ rejectedAt: expect.any(String), endedAt: expect.any(String) }),
    );
  });

  it('raises EventEmitter max listeners for high SSE fan-out', () => {
    const manager = new TaskManager();

    expect(manager.getMaxListeners()).toBe(100);
  });

  it('tracks tasks, lifecycle counts, artifacts, history and push notifications', () => {
    const manager = new TaskManager();
    const task = manager.createTask('session-1', 'context-1');
    const completedTask = manager.createTask(undefined, 'context-1');
    const failedTask = manager.createTask();
    const canceledTask = manager.createTask();
    const inputRequiredTask = manager.createTask();

    manager.setPushNotification(task.id, { url: 'https://example.com/hook', token: 'abc' });
    manager.setTaskExtensions(task.id, ['https://example.com/extensions/citations/v1']);
    manager.addHistoryMessage(task.id, {
      role: 'user',
      messageId: 'message-1',
      timestamp: new Date().toISOString(),
      parts: [{ type: 'text', text: 'hello' }],
    });
    manager.addArtifact(task.id, {
      artifactId: 'artifact-1',
      parts: [{ type: 'text', text: 'hello back' }],
      index: 0,
      lastChunk: true,
    });
    manager.updateTaskState(
      task.id,
      'working',
      {
        role: 'agent',
        messageId: 'message-2',
        timestamp: new Date().toISOString(),
        parts: [{ type: 'text', text: 'working' }],
      },
      {
        message: 'Processing started',
        jobId: 'job-1',
      },
    );
    manager.updateTaskState(completedTask.id, 'completed');
    manager.updateTaskState(failedTask.id, 'failed');
    manager.cancelTask(canceledTask.id);
    manager.updateTaskState(inputRequiredTask.id, 'input-required');

    expect(manager.getTasksByContextId('context-1')).toHaveLength(2);
    expect(manager.getTasksByContext('context-1')).toHaveLength(2);
    expect(manager.getAllTasks()).toHaveLength(5);
    expect(manager.getPushNotification(task.id)).toEqual({
      url: 'https://example.com/hook',
      token: 'abc',
    });

    const storedTask = manager.getTask(task.id);
    expect(storedTask?.history).toHaveLength(2);
    expect(storedTask?.history[0]?.contextId).toBe('context-1');
    expect(storedTask?.history[1]?.contextId).toBe('context-1');
    expect(storedTask?.artifacts?.[0]).toEqual(
      expect.objectContaining({
        extensions: ['https://example.com/extensions/citations/v1'],
        metadata: expect.objectContaining({
          contextId: 'context-1',
        }),
      }),
    );
    expect(storedTask?.status).toEqual(
      expect.objectContaining({
        state: 'WORKING',
        message: 'Processing started',
      }),
    );
    expect(storedTask?.metadata).toEqual(
      expect.objectContaining({
        createdAt: expect.any(String),
        startedAt: expect.any(String),
        message: 'Processing started',
        jobId: 'job-1',
      }),
    );

    expect(manager.getTaskCounts()).toEqual({
      total: 5,
      active: 2,
      completed: 1,
      failed: 1,
      canceled: 1,
      rejected: 0,
      submitted: 0,
      queued: 0,
      inputRequired: 1,
      authRequired: 0,
      waitingOnExternal: 0,
      working: 1,
    });
  });

  it('returns undefined for unknown tasks and missing push notification records', () => {
    const manager = new TaskManager();
    const message = {
      role: 'user' as const,
      messageId: 'missing-message',
      timestamp: new Date().toISOString(),
      parts: [{ type: 'text' as const, text: 'hello' }],
    };
    const artifact = {
      artifactId: 'missing-artifact',
      parts: [{ type: 'text' as const, text: 'nope' }],
      index: 0,
      lastChunk: true,
    };

    expect(manager.addHistoryMessage('missing', message)).toBeUndefined();
    expect(manager.addArtifact('missing', artifact)).toBeUndefined();
    expect(manager.updateTaskState('missing', 'failed')).toBeUndefined();
    expect(manager.cancelTask('missing')).toBeUndefined();
    expect(manager.setTaskExtensions('missing', ['urn:test'])).toBeUndefined();
    expect(
      manager.setPushNotification('missing', { url: 'https://example.com/hook' }),
    ).toBeUndefined();
    expect(manager.getPushNotification('missing')).toBeUndefined();
    expect(manager.removePushNotification('missing')).toBe(false);
  });

  it('rejects invalid transitions and terminal mutations', () => {
    const manager = new TaskManager();
    const task = manager.createTask();

    manager.updateTaskState(task.id, 'completed');

    expect(() => manager.updateTaskState(task.id, 'working')).toThrow(TaskLifecycleError);
    expect(() =>
      manager.addArtifact(task.id, {
        artifactId: 'artifact-terminal',
        parts: [{ type: 'text', text: 'late artifact' }],
        index: 0,
      }),
    ).toThrow(/terminal task/i);
    expect(() => manager.setPushNotification(task.id, { url: 'https://example.com/hook' })).toThrow(
      /terminal task/i,
    );
  });

  it('captures timing metadata for terminal states', async () => {
    const manager = new TaskManager();
    const task = manager.createTask();

    manager.updateTaskState(task.id, 'working');
    await new Promise((resolve) => setTimeout(resolve, 5));
    manager.updateTaskState(task.id, 'failed');

    expect(manager.getTask(task.id)?.metadata).toEqual(
      expect.objectContaining({
        createdAt: expect.any(String),
        startedAt: expect.any(String),
        endedAt: expect.any(String),
        failedAt: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
  });

  it('captures timing metadata for interrupted A2A v1 states', () => {
    const manager = new TaskManager();
    const task = manager.createTask();

    manager.updateTaskState(task.id, 'working');
    manager.updateTaskState(task.id, 'auth-required');

    expect(manager.getTask(task.id)?.metadata).toEqual(
      expect.objectContaining({
        createdAt: expect.any(String),
        startedAt: expect.any(String),
        authRequiredAt: expect.any(String),
      }),
    );
  });

  it('emits push config removal events and rejects terminal removals', () => {
    const manager = new TaskManager();
    const events: Array<{ reason: string }> = [];
    manager.on('taskUpdated', (event) => events.push({ reason: event.reason }));
    const task = manager.createTask();

    manager.setPushNotification(task.id, { url: 'https://example.com/hook' });
    expect(manager.removePushNotification(task.id)).toBe(true);
    expect(manager.removePushNotification(task.id)).toBe(false);

    expect(events.map((event) => event.reason)).toEqual(['created', 'push-config', 'push-config']);
  });

  it('rejects push config removal on terminal tasks', () => {
    const manager = new TaskManager();
    const task = manager.createTask();

    manager.setPushNotification(task.id, { url: 'https://example.com/hook' });
    manager.updateTaskState(task.id, 'completed');

    expect(() => manager.removePushNotification(task.id)).toThrow(/terminal task/i);
  });

  it('manages multiple push notification configs independently', () => {
    const manager = new TaskManager();
    const task = manager.createTask();
    const events: string[] = [];
    manager.on('taskUpdated', (event) => events.push(event.reason));

    expect(manager.listPushNotifications('missing')).toEqual([]);
    expect(manager.getPushNotificationConfig(task.id, 'missing')).toBeUndefined();
    expect(manager.removePushNotificationConfig(task.id, 'missing')).toBe(false);

    expect(
      manager.setPushNotificationConfig(task.id, 'email', {
        url: 'https://example.com/email',
      }),
    ).toEqual({ url: 'https://example.com/email' });
    expect(
      manager.setPushNotificationConfig(task.id, 'pager', {
        id: 'pager',
        url: 'https://example.com/pager',
      }),
    ).toEqual({ id: 'pager', url: 'https://example.com/pager' });

    expect(manager.listPushNotifications(task.id)).toEqual([
      { url: 'https://example.com/email' },
      { id: 'pager', url: 'https://example.com/pager' },
    ]);
    expect(manager.getPushNotificationConfig(task.id, 'email')).toEqual({
      url: 'https://example.com/email',
    });
    expect(manager.removePushNotificationConfig(task.id, 'email')).toBe(true);
    expect(manager.getPushNotificationConfig(task.id, 'email')).toBeUndefined();
    expect(manager.listPushNotifications(task.id)).toEqual([
      { id: 'pager', url: 'https://example.com/pager' },
    ]);
    expect(events.filter((reason) => reason === 'push-config')).toHaveLength(3);
  });
});
