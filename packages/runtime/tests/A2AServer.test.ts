import { afterEach, describe, expect, it } from 'vitest';
import { A2AServer } from '../src/server/A2AServer.js';
import { getRequestContext } from '@a2amesh/runtime';
import { ErrorCodes, JsonRpcError, type JsonRpcRequest } from '../src/types/jsonrpc.js';
import type { A2AServerOptions } from '../src/server/A2AServer.js';
import type { AgentCard } from '../src/types/agent-card.js';
import type { Artifact, Message, Task } from '../src/types/task.js';

function createAgentCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Harness Agent',
    description: 'Test harness agent',
    url: 'http://localhost:0',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
      extendedAgentCard: true,
    },
    extensions: [{ uri: 'https://example.com/extensions/citations/v1' }],
    ...overrides,
  };
}

class HarnessServer extends A2AServer {
  constructor(
    private readonly mode: 'success' | 'failure' = 'success',
    cardOverrides: Partial<AgentCard> = {},
    withAuth = false,
    optionOverrides: A2AServerOptions = {},
  ) {
    super(
      createAgentCard(cardOverrides),
      withAuth
        ? {
            allowUnresolvedHostnames: true,
            auth: {
              securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
              apiKeys: { 'api-key': 'secret' },
            },
            ...optionOverrides,
          }
        : { allowUnresolvedHostnames: true, ...optionOverrides },
    );
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    if (this.mode === 'failure') {
      throw new Error('boom');
    }

    const textPart = message.parts.find((part) => part.type === 'text');
    return [
      {
        artifactId: 'artifact-1',
        parts: [{ type: 'text', text: textPart?.type === 'text' ? textPart.text : 'empty' }],
        index: 0,
        lastChunk: true,
      },
    ];
  }

  async callRpc(request: JsonRpcRequest, headers: Record<string, string> = {}): Promise<unknown> {
    const req = {
      header(name: string) {
        return headers[name] ?? headers[name.toLowerCase()];
      },
      query: {},
      body: request,
      requestId: 'request-1',
    } as never;
    const requestContext = this.authMiddleware
      ? await this.authMiddleware.authenticateRequestContext(req).catch(() => {
          throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized');
        })
      : getRequestContext(req);

    return this.handleRpc(request, { req, requestContext });
  }

  normalize(task: Task, artifacts: Artifact[]) {
    return this.normalizeArtifacts(task, artifacts);
  }

  async process(task: Task, message: Message): Promise<void> {
    return this.processTaskInternal(task, message);
  }

  getTask(taskId: string): Task | undefined {
    return this.taskManager.getTask(taskId);
  }

  createTask(contextId?: string): Task {
    return this.taskManager.createTask(undefined, contextId);
  }
}

class DelayedHarnessServer extends HarnessServer {
  private releaseTask!: () => void;
  private readonly taskGate = new Promise<void>((resolve) => {
    this.releaseTask = resolve;
  });

  completeTask(): void {
    this.releaseTask();
  }

  override async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    await this.taskGate;
    return super.handleTask(task, message);
  }
}

describe('A2AServer', () => {
  const handles: Array<{ close: (cb: () => void) => void }> = [];

  afterEach(async () => {
    await Promise.all(
      handles.map(
        (handle) =>
          new Promise<void>((resolve) => {
            handle.close(() => resolve());
          }),
      ),
    );
    handles.length = 0;
  });

  it('exposes express internals and normalizes legacy agent cards', () => {
    const server = new HarnessServer();
    expect(server.getExpressApp()).toBeTruthy();
    expect(server.getAgentCard().name).toBe('Harness Agent');
    expect(
      A2AServer.fromCard({
        protocolVersion: '0.3' as '1.0',
        name: 'Legacy',
        description: 'desc',
        url: 'http://legacy',
        version: '0.3',
      }),
    ).toEqual(
      expect.objectContaining({
        protocolVersion: '1.0',
        name: 'Legacy',
      }),
    );
  });

  it('returns validation errors for invalid HTTP requests and stream requests without a task id', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);

    await new Promise((resolve) => setTimeout(resolve, 25));
    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;

    const invalidRpcResponse = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', method: 'message/send', id: 'bad-request' }),
    });
    const invalidPayload = (await invalidRpcResponse.json()) as {
      error: { code: number; message: string; data?: unknown };
    };
    expect(invalidPayload.error.code).toBe(ErrorCodes.InvalidRequest);
    expect(invalidPayload.error.message).toBe('Invalid JSON-RPC request');
    expect(invalidPayload.error.data).toEqual([
      expect.objectContaining({
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'INVALID_REQUEST',
        domain: 'a2a-protocol.org',
      }),
    ]);

    const streamResponse = await fetch(`${baseUrl}/stream`);
    expect(streamResponse.status).toBe(400);
    expect(await streamResponse.text()).toContain('Missing taskId');
  });

  it('waits for message/send by default and supports immediate returns', async () => {
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      messageId: 'delayed-message',
      timestamp: new Date().toISOString(),
    };

    const blockingServer = new DelayedHarnessServer();
    let settled = false;
    const pendingTask = blockingServer
      .callRpc({
        jsonrpc: '2.0',
        id: 'send-blocking',
        method: 'message/send',
        params: { message },
      })
      .then((value) => {
        settled = true;
        return value as Task;
      });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    blockingServer.completeTask();
    const blockingTask = await pendingTask;
    expect(blockingTask.status.state).toBe('COMPLETED');
    expect(blockingTask.artifacts?.[0]?.artifactId).toBe('artifact-1');

    const immediateServer = new DelayedHarnessServer();
    const immediateTask = (await immediateServer.callRpc({
      jsonrpc: '2.0',
      id: 'send-immediate',
      method: 'message/send',
      params: {
        message: { ...message, messageId: 'immediate-message' },
        configuration: { returnImmediately: true, historyLength: 0 },
      },
    })) as Task;

    expect(['SUBMITTED', 'WORKING', 'COMPLETED']).toContain(immediateTask.status.state);
    expect(immediateTask.history).toEqual([]);

    immediateServer.completeTask();
    for (
      let i = 0;
      i < 10 && immediateServer.getTask(immediateTask.id)?.status.state !== 'COMPLETED';
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(immediateServer.getTask(immediateTask.id)?.status.state).toBe('COMPLETED');
  });

  it('accepts A2A v1 send configuration aliases', async () => {
    const server = new HarnessServer();
    const task = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'send-v1-config',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
          messageId: 'v1-config-message',
          timestamp: new Date().toISOString(),
        },
        configuration: {
          return_immediately: false,
          history_length: 0,
          task_push_notification_config: { url: 'https://example.com/hook' },
        },
      },
    })) as Task;

    expect(task.status.state).toBe('COMPLETED');
    expect(task.history).toEqual([]);

    const pushConfig = await server.callRpc({
      jsonrpc: '2.0',
      id: 'push-get-v1-config',
      method: 'tasks/pushNotification/get',
      params: { taskId: task.id },
    });
    expect(pushConfig).toEqual(expect.objectContaining({ url: 'https://example.com/hook' }));
  });

  it('applies canonical send configuration and keeps legacy blocking behavior', async () => {
    const server = new HarnessServer('success');
    const immediateTask = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'send-canonical-config',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'canonical config' }],
          messageId: 'canonical-config-message',
          timestamp: new Date().toISOString(),
        },
        configuration: {
          returnImmediately: false,
          historyLength: 1,
          acceptedOutputModes: ['text/plain'],
        },
      },
    })) as Task;

    expect(immediateTask.status.state).toBe('COMPLETED');
    expect(immediateTask.history).toHaveLength(1);
    expect(immediateTask.history[0]?.messageId).toBe('canonical-config-message');

    const blockingTask = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'send-legacy-blocking-config',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'legacy blocking config' }],
          messageId: 'legacy-blocking-config-message',
          timestamp: new Date().toISOString(),
        },
        configuration: { blocking: true, historyLength: 0 },
      },
    })) as Task;

    expect(blockingTask.status.state).toBe('COMPLETED');
    expect(blockingTask.history).toEqual([]);
  });

  it('handles rpc task lifecycle, extension negotiation and auth errors', async () => {
    const server = new HarnessServer('success', {}, true);
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      messageId: 'message-1',
      timestamp: new Date().toISOString(),
    };

    const task = (await server.callRpc(
      {
        jsonrpc: '2.0',
        id: 'send-1',
        method: 'message/send',
        params: {
          message,
          contextId: 'ctx-1',
          configuration: {
            extensions: [{ uri: 'https://example.com/extensions/citations/v1', required: true }],
          },
        },
      },
      { 'x-api-key': 'secret' },
    )) as Task;

    expect(task.contextId).toBe('ctx-1');

    await expect(
      server.callRpc(
        {
          jsonrpc: '2.0',
          id: 'context-mismatch-1',
          method: 'message/send',
          params: {
            taskId: task.id,
            contextId: 'ctx-other',
            message,
          },
        },
        { 'x-api-key': 'secret' },
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'contextId does not match task contextId',
    });

    const continuationTarget = server
      .getTaskManager()
      .createTask(undefined, 'ctx-1', 'api-key:api-key');
    await expect(
      server.callRpc(
        {
          jsonrpc: '2.0',
          id: 'context-match-1',
          method: 'message/send',
          params: {
            taskId: continuationTarget.id,
            contextId: 'ctx-1',
            message: { ...message, messageId: 'message-1-follow-up' },
          },
        },
        { 'x-api-key': 'secret' },
      ),
    ).resolves.toMatchObject({
      id: continuationTarget.id,
      contextId: 'ctx-1',
    });
    expect(
      (
        (await server.callRpc(
          {
            jsonrpc: '2.0',
            id: 'get-1',
            method: 'tasks/get',
            params: { taskId: task.id },
          },
          { 'x-api-key': 'secret' },
        )) as Task
      ).id,
    ).toBe(task.id);
    const cancelTarget = server.getTaskManager().createTask(undefined, 'ctx-1', 'api-key:api-key');
    expect(
      (
        (await server.callRpc(
          {
            jsonrpc: '2.0',
            id: 'cancel-1',
            method: 'tasks/cancel',
            params: { taskId: cancelTarget.id },
          },
          { 'x-api-key': 'secret' },
        )) as Task
      ).status.state,
    ).toBe('CANCELED');

    await expect(
      server.callRpc(
        {
          jsonrpc: '2.0',
          id: 'ext-1',
          method: 'message/send',
          params: {
            message,
            configuration: {
              extensions: [{ uri: 'https://unsupported.example/extensions/a', required: true }],
            },
          },
        },
        { 'x-api-key': 'secret' },
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.ExtensionRequired,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'auth-1',
        method: 'agent/authenticatedExtendedCard',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.Unauthorized,
    });

    expect(
      await server.callRpc(
        {
          jsonrpc: '2.0',
          id: 'auth-2',
          method: 'agent/authenticatedExtendedCard',
        },
        { 'x-api-key': 'secret' },
      ),
    ).toEqual(expect.objectContaining({ name: 'Harness Agent' }));

    expect(
      await server.callRpc(
        {
          jsonrpc: '2.0',
          id: 'auth-3',
          method: 'agent/getAuthenticatedExtendedCard',
        },
        { 'x-api-key': 'secret' },
      ),
    ).toEqual(expect.objectContaining({ name: 'Harness Agent' }));
  });

  it('lists tasks, skips unsupported optional extensions and reports health details', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;

    const task = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'list-1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'hello list' }],
          messageId: 'message-list-1',
          timestamp: new Date().toISOString(),
        },
        contextId: 'ctx-list',
        configuration: {
          extensions: [
            { uri: 'https://example.com/extensions/citations/v1', required: true },
            { uri: 'https://unsupported.example/extensions/optional', required: false },
          ],
        },
      },
    })) as Task;

    expect(task.extensions).toEqual(['https://example.com/extensions/citations/v1']);

    const listed = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'list-2',
      method: 'tasks/list',
      params: {
        contextId: 'ctx-list',
        limit: 10,
        offset: 0,
      },
    })) as { tasks: Task[]; total: number };

    expect(listed.total).toBe(1);
    expect(listed.tasks[0]?.id).toBe(task.id);

    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = (await healthResponse.json()) as {
      protocol: string;
      uptime: number;
      tasks: { total: number; active: number };
      memory: { heapUsedMb: number; heapTotalMb: number };
    };

    expect(health.protocol).toBe('A2A/1.0');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(health.tasks.total).toBeGreaterThanOrEqual(1);
    expect(health.tasks.active).toBeGreaterThanOrEqual(0);
    expect(health.memory.heapUsedMb).toBeGreaterThan(0);
    expect(health.memory.heapTotalMb).toBeGreaterThan(0);
  });

  it('rejects terminal task reuse, stores push configs and lists all tasks without a context filter', async () => {
    const server = new HarnessServer();
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello again' }],
      messageId: 'message-reuse-1',
      timestamp: new Date().toISOString(),
    };

    const created = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'reuse-1',
      method: 'message/send',
      params: {
        message,
      },
    })) as Task;

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-get-empty',
        method: 'tasks/pushNotification/get',
        params: { taskId: created.id },
      }),
    ).toBeNull();

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'reuse-2',
        method: 'message/send',
        params: {
          taskId: created.id,
          message: {
            ...message,
            messageId: 'message-reuse-2',
          },
        },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidTaskTransition,
    });

    const pending = server.createTask();
    const pushConfig = {
      url: 'https://example.com/hook',
    };
    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-set',
        method: 'tasks/pushNotification/set',
        params: {
          taskId: pending.id,
          pushNotificationConfig: pushConfig,
        },
      }),
    ).toEqual(pushConfig);

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-get',
        method: 'tasks/pushNotification/get',
        params: { taskId: pending.id },
      }),
    ).toEqual(pushConfig);

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-create-email',
        method: 'tasks/pushNotificationConfig/create',
        params: {
          taskId: pending.id,
          configId: 'email',
          pushNotificationConfig: {
            url: 'https://example.com/email-hook',
            token: 'email-token',
          },
        },
      }),
    ).toEqual({ url: 'https://example.com/email-hook', token: 'email-token' });

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-create-pager',
        method: 'tasks/pushNotificationConfig/create',
        params: {
          taskPushNotificationConfig: {
            taskId: pending.id,
            pushNotificationConfig: {
              id: 'pager',
              url: 'https://example.com/pager-hook',
            },
          },
        },
      }),
    ).toEqual({ id: 'pager', url: 'https://example.com/pager-hook' });

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-get-email',
        method: 'tasks/pushNotificationConfig/get',
        params: { taskId: pending.id, configId: 'email' },
      }),
    ).toEqual({ url: 'https://example.com/email-hook', token: 'email-token' });

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-list-configs',
        method: 'tasks/pushNotificationConfig/list',
        params: { taskId: pending.id },
      }),
    ).toEqual({
      configs: expect.arrayContaining([
        pushConfig,
        { url: 'https://example.com/email-hook', token: 'email-token' },
        { id: 'pager', url: 'https://example.com/pager-hook' },
      ]),
    });

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-delete-email',
        method: 'tasks/pushNotificationConfig/delete',
        params: { taskId: pending.id, configId: 'email' },
      }),
    ).toEqual({ deleted: true });

    expect(
      await server.callRpc({
        jsonrpc: '2.0',
        id: 'push-get-email-after-delete',
        method: 'tasks/pushNotificationConfig/get',
        params: { taskId: pending.id, configId: 'email' },
      }),
    ).toBeNull();

    const listed = (await server.callRpc({
      jsonrpc: '2.0',
      id: 'list-all',
      method: 'tasks/list',
      params: {},
    })) as { tasks: Task[]; total: number };

    expect(listed.total).toBeGreaterThanOrEqual(1);
    expect(listed.tasks.some((task) => task.id === created.id)).toBe(true);
    expect(listed.tasks.some((task) => task.id === pending.id)).toBe(true);
  });

  it('rejects unsupported operations and missing task parameters', async () => {
    const server = new HarnessServer('success', {
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
        extendedAgentCard: false,
      },
      extensions: [],
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'missing-task',
        method: 'tasks/get',
        params: {},
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'unsupported-card',
        method: 'agent/authenticatedExtendedCard',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.UnsupportedOperation,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'unknown-method',
        method: 'tasks/unknown',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.MethodNotFound,
    });
  });

  it('rejects missing push params and unknown task ids across task operations', async () => {
    const server = new HarnessServer();
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'unknown task' }],
      messageId: 'message-unknown-task',
      timestamp: new Date().toISOString(),
    };

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'push-invalid',
        method: 'tasks/pushNotification/set',
        params: {
          taskId: 'missing-task',
        },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'push-get-invalid',
        method: 'tasks/pushNotification/get',
        params: {},
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });

    const task = server.createTask();
    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'push-set-invalid-auth',
        method: 'tasks/pushNotification/set',
        params: {
          taskId: task.id,
          pushNotificationConfig: {
            url: 'https://example.com/hook',
            authentication: {
              type: 'apiKey',
              id: 'webhook-key',
              in: 'cookie',
              name: 'x-webhook-key',
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'cancel-missing',
        method: 'tasks/cancel',
        params: { taskId: 'missing-task' },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.TaskNotFound,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'send-missing',
        method: 'message/send',
        params: {
          taskId: 'missing-task',
          message,
        },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.TaskNotFound,
    });

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'push-set-missing-task',
        method: 'tasks/pushNotification/set',
        params: {
          taskId: 'missing-task',
          pushNotificationConfig: { url: 'https://example.com/hook' },
        },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.TaskNotFound,
    });
  });

  it('rejects the authenticated extended card when auth is not configured', async () => {
    const server = new HarnessServer();

    await expect(
      server.callRpc({
        jsonrpc: '2.0',
        id: 'auth-open',
        method: 'agent/authenticatedExtendedCard',
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.Unauthorized,
      message: 'Authenticated extended card requires authentication',
    });
  });

  it('fails closed for browser origins unless allowed origins are explicitly configured', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const response = await fetch(`http://localhost:${port}/health`, {
      headers: { Origin: 'https://app.example.com' },
    });

    expect(response.status).toBe(403);
  });

  it('allows configured wildcard subdomain origins', async () => {
    const server = new HarnessServer('success', {}, false, {
      allowedOrigins: ['*.example.com'],
    });
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const response = await fetch(`http://localhost:${port}/health`, {
      headers: { Origin: 'https://app.example.com' },
    });

    expect(response.status).toBe(200);
  });

  it('normalizes artifact metadata and marks failed tasks when task processing raises', async () => {
    const successServer = new HarnessServer();
    const task = successServer.createTask('ctx-42');
    task.extensions = ['https://example.com/extensions/citations/v1'];
    const normalized = successServer.normalize(task, [
      {
        artifactId: 'artifact-1',
        parts: [{ type: 'text', text: 'hi' }],
        index: 0,
      },
    ]);

    expect(normalized[0]).toEqual(
      expect.objectContaining({
        extensions: ['https://example.com/extensions/citations/v1'],
        metadata: expect.objectContaining({
          taskId: task.id,
          contextId: 'ctx-42',
          appliedExtensions: ['https://example.com/extensions/citations/v1'],
        }),
      }),
    );

    const failureServer = new HarnessServer('failure');
    const failingTask = failureServer.createTask('ctx-fail');
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'explode' }],
      messageId: 'message-2',
      timestamp: new Date().toISOString(),
    };

    await expect(failureServer.process(failingTask, message)).rejects.toThrow('boom');
    expect(failureServer.getTask(failingTask.id)?.status.state).toBe('FAILED');
  });

  it('stores artifacts and marks tasks completed when task processing succeeds', async () => {
    const server = new HarnessServer();
    const task = server.createTask('ctx-success');
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'done' }],
      messageId: 'message-success',
      timestamp: new Date().toISOString(),
    };

    await server.process(task, message);

    expect(server.getTask(task.id)).toEqual(
      expect.objectContaining({
        status: expect.objectContaining({ state: 'COMPLETED' }),
        artifacts: [
          expect.objectContaining({
            artifactId: 'artifact-1',
          }),
        ],
      }),
    );
  });

  it('accepts official A2A +json media types for HTTP JSON bodies', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello a2a media type' }],
      messageId: 'message-a2a-media-type',
      timestamp: new Date().toISOString(),
    };

    const restResponse = await fetch(`${baseUrl}/message:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json' },
      body: JSON.stringify({ message }),
    });
    expect(restResponse.status).toBe(200);
    expect(restResponse.headers.get('content-type')).toContain('application/a2a+json');
    expect(((await restResponse.json()) as Task).id).toBeTruthy();

    const rpcResponse = await fetch(`${baseUrl}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'a2a-media-rpc',
        method: 'message/send',
        params: { message: { ...message, messageId: 'message-a2a-media-rpc' } },
      }),
    });
    expect(rpcResponse.status).toBe(200);
    expect((await rpcResponse.json()) as { result: Task }).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({ id: expect.any(String) }),
      }),
    );
  });

  it('serves A2A HTTP+JSON REST binding endpoints', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hello rest' }],
      messageId: 'message-rest-1',
      timestamp: new Date().toISOString(),
    };

    const sendResponse = await fetch(`${baseUrl}/message:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    expect(sendResponse.status).toBe(200);
    const sentTask = (await sendResponse.json()) as Task;
    expect(sentTask.id).toBeTruthy();

    const getResponse = await fetch(`${baseUrl}/tasks/${sentTask.id}`);
    expect(getResponse.status).toBe(200);
    const fetchedTask = (await getResponse.json()) as Task;
    expect(fetchedTask.id).toBe(sentTask.id);

    const cancelTarget = server.createTask('ctx-rest-cancel');
    const cancelResponse = await fetch(`${baseUrl}/tasks/${cancelTarget.id}:cancel`, {
      method: 'POST',
    });
    expect(cancelResponse.status).toBe(200);
    const canceledTask = (await cancelResponse.json()) as Task;
    expect(canceledTask.status.state).toBe('CANCELED');

    const pushTarget = server.createTask('ctx-rest-push');
    const pushConfig = {
      url: 'https://example.com/hook',
      token: 'rest-token',
    };
    const setPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskPushNotificationConfig: pushConfig }),
      },
    );
    expect(setPushResponse.status).toBe(200);
    expect(await setPushResponse.json()).toEqual(pushConfig);

    const listPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs`,
    );
    expect(listPushResponse.status).toBe(200);
    expect((await listPushResponse.json()) as { configs: unknown[] }).toEqual({
      configs: [pushConfig],
    });

    const setSmsPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: 'sms',
          taskPushNotificationConfig: { url: 'https://example.com/sms-hook' },
        }),
      },
    );
    expect(setSmsPushResponse.status).toBe(200);
    expect(await setSmsPushResponse.json()).toEqual({ url: 'https://example.com/sms-hook' });

    const listMultiPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs`,
    );
    expect(listMultiPushResponse.status).toBe(200);
    expect((await listMultiPushResponse.json()) as { configs: unknown[] }).toEqual({
      configs: expect.arrayContaining([pushConfig, { url: 'https://example.com/sms-hook' }]),
    });

    const getSmsPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs/sms`,
    );
    expect(getSmsPushResponse.status).toBe(200);
    expect(await getSmsPushResponse.json()).toEqual({ url: 'https://example.com/sms-hook' });

    const getPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs/default`,
    );
    expect(getPushResponse.status).toBe(200);
    expect(await getPushResponse.json()).toEqual(pushConfig);

    const deletePushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs/default`,
      { method: 'DELETE' },
    );
    expect(deletePushResponse.status).toBe(204);

    const deleteSmsPushResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs/sms`,
      { method: 'DELETE' },
    );
    expect(deleteSmsPushResponse.status).toBe(204);

    const listAfterDeleteResponse = await fetch(
      `${baseUrl}/tasks/${pushTarget.id}/pushNotificationConfigs`,
    );
    expect((await listAfterDeleteResponse.json()) as { configs: unknown[] }).toEqual({
      configs: [],
    });
  });

  it('handles REST binding tenant aliases and error branches', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;

    const firstTask = server.createTask('ctx-rest-list-a');
    server.createTask('ctx-rest-list-b');

    const listResponse = await fetch(`${baseUrl}/tasks?limit=1&offset=1`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get('content-type')).toContain('application/a2a+json');
    expect(listResponse.headers.get('x-a2a-page-limit')).toBe('1');
    expect(listResponse.headers.get('x-a2a-page-offset')).toBe('1');
    expect(listResponse.headers.get('x-a2a-page-total')).toBe('2');
    expect((await listResponse.json()) as Task[]).toHaveLength(1);

    const tenantGetResponse = await fetch(`${baseUrl}/tenant-a/tasks/${firstTask.id}`);
    expect(tenantGetResponse.status).toBe(200);
    expect(((await tenantGetResponse.json()) as Task).id).toBe(firstTask.id);

    const missingTaskResponse = await fetch(`${baseUrl}/tasks/missing-task`);
    expect(missingTaskResponse.status).toBe(404);
    expect(missingTaskResponse.headers.get('content-type')).toContain('application/problem+json');
    expect(await missingTaskResponse.json()).toEqual(
      expect.objectContaining({
        type: 'https://a2a-protocol.org/errors/task-not-found',
        title: 'Task Not Found',
        status: 404,
        detail: 'Task not found',
        code: ErrorCodes.TaskNotFound,
      }),
    );

    const deleteMissingConfigResponse = await fetch(
      `${baseUrl}/tasks/${firstTask.id}/pushNotificationConfigs/default`,
      { method: 'DELETE' },
    );
    expect(deleteMissingConfigResponse.status).toBe(204);

    const tenantPushConfig = { url: 'https://example.com/rest-callback' };
    const tenantSetPushResponse = await fetch(
      `${baseUrl}/tenant-a/tasks/${firstTask.id}/pushNotificationConfigs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: tenantPushConfig }),
      },
    );
    expect(tenantSetPushResponse.status).toBe(200);
    expect(await tenantSetPushResponse.json()).toEqual(tenantPushConfig);

    const tenantListPushResponse = await fetch(
      `${baseUrl}/tenant-a/tasks/${firstTask.id}/pushNotificationConfigs`,
    );
    expect(tenantListPushResponse.status).toBe(200);
    expect((await tenantListPushResponse.json()) as { configs: unknown[] }).toEqual({
      configs: [tenantPushConfig],
    });
  });

  it('accepts omitted and explicit protocol version compatibility fixtures', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;

    const legacyResponse = await fetch(`${baseUrl}/message:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json' },
      body: JSON.stringify({
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'legacy default' }],
          messageId: 'message-legacy-default',
          timestamp: new Date().toISOString(),
        },
      }),
    });
    expect(legacyResponse.status).toBe(200);

    const v1Response = await fetch(`${baseUrl}/message:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json', 'A2A-Version': '1.0' },
      body: JSON.stringify({
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'explicit v1' }],
          messageId: 'message-explicit-v1',
          timestamp: new Date().toISOString(),
        },
      }),
    });
    expect(v1Response.status).toBe(200);
  });


  it('returns explicit errors for unsupported requested protocol versions', async () => {
    const server = new HarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'version negotiation' }],
      messageId: 'message-version-negotiation',
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(`${baseUrl}/message:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json', 'A2A-Version': '9.9' },
      body: JSON.stringify({ message }),
    });
    const problem = (await response.json()) as { title: string; supportedVersions: string[] };

    expect(response.status).toBe(400);
    expect(problem.title).toBe('Protocol Version Not Supported');
    expect(problem.supportedVersions).toEqual(expect.arrayContaining(['1.0', '1.2', '0.3']));
  });


  it('requires credentials before returning the extended card through JSON-RPC HTTP', async () => {
    const server = new HarnessServer('success', {}, true);
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const baseUrl = `http://localhost:${port}`;
    const method = ['agent', 'authenticatedExtendedCard'].join('/');
    const headerName = ['x', 'api', 'key'].join('-');
    const apiKey = ['sec', 'ret'].join('');

    const publicResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    expect(publicResponse.status).toBe(200);
    expect((await publicResponse.json()) as AgentCard).toEqual(
      expect.objectContaining({
        name: 'Harness Agent',
        capabilities: expect.objectContaining({ extendedAgentCard: true }),
      }),
    );

    const unauthenticatedResponse = await fetch(`${baseUrl}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json', 'A2A-Version': '1.0' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'extended-card-unauthenticated', method }),
    });
    const unauthenticatedPayload = (await unauthenticatedResponse.json()) as { error: { code: number } };
    expect(unauthenticatedResponse.status).toBe(200);
    expect(unauthenticatedPayload.error.code).toBe(ErrorCodes.Unauthorized);

    const authenticatedResponse = await fetch(`${baseUrl}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/a2a+json', 'A2A-Version': '1.0', [headerName]: apiKey },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'extended-card-authenticated', method }),
    });
    const authenticatedPayload = (await authenticatedResponse.json()) as { result: AgentCard };
    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedPayload.result).toEqual(expect.objectContaining({ name: 'Harness Agent' }));
  });

});
