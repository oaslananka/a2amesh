import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { JwtAuthMiddleware } from '../src/auth/JwtAuthMiddleware.js';
import { TaskManager } from '../src/server/TaskManager.js';
import {
  canAccessTask,
  dispatchJsonRpcMethod,
  filterTasksByContext,
  getTaskOrThrow,
} from '../src/server/http/jsonRpcMethodDispatch.js';
import type { AgentCard } from '../src/types/agent-card.js';
import type { RequestContext } from '../src/types/auth.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';
import type { MessageSendParams, PushNotificationConfig, Task } from '../src/types/task.js';

const agentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'Dispatch Test Agent',
  description: 'JSON-RPC dispatch tests',
  url: 'https://agent.example.test',
  version: '1.0.0',
  capabilities: { extendedAgentCard: true },
};

function requestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'request-1',
    authMethod: 'anonymous',
    scopes: [],
    roles: [],
    claims: {},
    ...overrides,
  };
}

function messageParams(): MessageSendParams {
  return {
    message: {
      role: 'user',
      messageId: 'message-1',
      timestamp: '2026-07-30T00:00:00.000Z',
      parts: [{ type: 'text', text: 'hello' }],
    },
  };
}

function createHarness(
  options: {
    authMiddleware?: JwtAuthMiddleware;
    card?: AgentCard;
  } = {},
) {
  const taskManager = new TaskManager();
  const normalizePushNotificationConfig = vi.fn(
    async (config: PushNotificationConfig): Promise<PushNotificationConfig> => ({ ...config }),
  );
  const handleMessageRequest = vi.fn(async (): Promise<Task> => taskManager.createTask());
  const req = {} as Request;
  const deps = {
    agentCard: options.card ?? agentCard,
    taskManager,
    authMiddleware: options.authMiddleware,
    normalizePushNotificationConfig,
    handleMessageRequest,
  };
  return { deps, handleMessageRequest, normalizePushNotificationConfig, req, taskManager };
}

describe('JSON-RPC method dispatch', () => {
  it('validates message/send parameters and delegates message execution', async () => {
    const { deps, handleMessageRequest, req } = createHarness();
    const params = messageParams();
    const expectedTask = deps.taskManager.createTask();
    handleMessageRequest.mockResolvedValueOnce(expectedTask);

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'send',
          method: 'message/send',
          params: params as unknown as Record<string, unknown>,
        },
        { req, requestContext: requestContext() },
        deps,
      ),
    ).resolves.toEqual(expectedTask);

    expect(handleMessageRequest).toHaveBeenCalledOnce();
    expect(handleMessageRequest).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ messageId: 'message-1' }) }),
      'message/send',
      req,
    );
  });

  it.each(['message/stream', 'tasks/resubscribe'])(
    '%s requires the SSE transport',
    async (method) => {
      const { deps, req } = createHarness();

      await expect(
        dispatchJsonRpcMethod(
          { jsonrpc: '2.0', id: method, method },
          { req, requestContext: requestContext() },
          deps,
        ),
      ).rejects.toMatchObject({
        code: ErrorCodes.UnsupportedOperation,
        message: `${method} requires an SSE response transport`,
      });
    },
  );

  it('gets, lists, filters, and cancels tasks with the existing ownership rules', async () => {
    const authMiddleware = {} as JwtAuthMiddleware;
    const { deps, req, taskManager } = createHarness({ authMiddleware });
    const owned = taskManager.createTask(undefined, 'context-a', 'principal-a', 'tenant-a');
    const other = taskManager.createTask(undefined, 'context-a', 'principal-b', 'tenant-a');
    const context = requestContext({
      authMethod: 'bearer',
      principalId: 'principal-a',
      tenantId: 'tenant-a',
    });

    await expect(
      dispatchJsonRpcMethod(
        { jsonrpc: '2.0', id: 'get', method: 'tasks/get', params: { taskId: owned.id } },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ id: owned.id });

    await expect(
      dispatchJsonRpcMethod(
        { jsonrpc: '2.0', id: 'forbidden', method: 'tasks/get', params: { taskId: other.id } },
        { req, requestContext: context },
        deps,
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.Unauthorized });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'list',
          method: 'tasks/list',
          params: { contextId: 'context-a', limit: 10, offset: 0 },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ tasks: [{ id: owned.id }], total: 1 });

    await expect(
      dispatchJsonRpcMethod(
        { jsonrpc: '2.0', id: 'cancel', method: 'tasks/cancel', params: { taskId: owned.id } },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ id: owned.id, status: { state: 'CANCELED' } });

    expect(canAccessTask(owned, context, authMiddleware)).toBe(true);
    expect(canAccessTask(other, context, authMiddleware)).toBe(false);
    expect(filterTasksByContext([owned, other], context, authMiddleware)).toEqual([owned]);
    expect(getTaskOrThrow(owned.id, taskManager, context, (task) => task.id === owned.id)).toEqual(
      expect.objectContaining({ id: owned.id }),
    );
  });

  it('preserves legacy and v1 push-notification configuration aliases', async () => {
    const { deps, normalizePushNotificationConfig, req, taskManager } = createHarness();
    const task = taskManager.createTask();
    const context = requestContext();

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'legacy-set',
          method: 'tasks/pushNotification/set',
          params: {
            taskId: task.id,
            pushNotificationConfig: { url: 'https://hooks.example.test/default' },
          },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ url: 'https://hooks.example.test/default' });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'create',
          method: 'tasks/pushNotificationConfig/create',
          params: {
            taskPushNotificationConfig: {
              taskId: task.id,
              pushNotificationConfig: {
                id: ' secondary ',
                url: 'https://hooks.example.test/secondary',
              },
            },
          },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ id: ' secondary ' });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'get-default',
          method: 'tasks/pushNotification/get',
          params: { taskId: task.id },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ url: 'https://hooks.example.test/default' });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'get-secondary',
          method: 'tasks/pushNotificationConfig/get',
          params: { taskId: task.id, configId: 'secondary' },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ url: 'https://hooks.example.test/secondary' });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'list-configs',
          method: 'tasks/pushNotificationConfig/list',
          params: { taskId: task.id },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toMatchObject({ configs: expect.arrayContaining([expect.any(Object)]) });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'delete-secondary',
          method: 'tasks/pushNotificationConfig/delete',
          params: { taskId: task.id, configId: 'secondary' },
        },
        { req, requestContext: context },
        deps,
      ),
    ).resolves.toEqual({ deleted: true });

    expect(normalizePushNotificationConfig).toHaveBeenCalledTimes(2);
  });

  it('returns authenticated extended cards and preserves bounded dispatch errors', async () => {
    const authMiddleware = {} as JwtAuthMiddleware;
    const { deps, req } = createHarness({ authMiddleware });

    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'card',
          method: 'agent/getAuthenticatedExtendedCard',
        },
        { req, requestContext: requestContext({ authMethod: 'bearer' }) },
        deps,
      ),
    ).resolves.toBe(agentCard);

    await expect(
      dispatchJsonRpcMethod(
        { jsonrpc: '2.0', id: 'missing', method: 'unknown/method' },
        { req, requestContext: requestContext() },
        deps,
      ),
    ).rejects.toMatchObject({
      code: ErrorCodes.MethodNotFound,
      message: 'Method unknown/method not found',
    });

    const unsupported = createHarness({
      card: { ...agentCard, capabilities: { extendedAgentCard: false } },
    });
    await expect(
      dispatchJsonRpcMethod(
        {
          jsonrpc: '2.0',
          id: 'unsupported',
          method: 'agent/authenticatedExtendedCard',
        },
        { req: unsupported.req, requestContext: requestContext() },
        unsupported.deps,
      ),
    ).rejects.toMatchObject({ code: ErrorCodes.UnsupportedOperation });
  });
});
