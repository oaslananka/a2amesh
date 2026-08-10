import type { Request } from 'express';
import type { JwtAuthMiddleware } from '../../auth/index.js';
import type { AgentCard } from '../../types/agent-card.js';
import type { RequestContext } from '../../types/auth.js';
import { ErrorCodes, JsonRpcError, type JsonRpcRequest } from '../../types/jsonrpc.js';
import type { MessageSendParams, PushNotificationConfig, Task } from '../../types/task.js';
import { makeErrorInfo } from '../../utils/errors.js';
import {
  PushNotificationConfigSchema,
  validateMessageSendParams,
  validateRequest,
  validateTaskListParams,
} from '../../utils/schema-validator.js';
import type { TaskManager } from '../TaskManager.js';

const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

export interface JsonRpcMethodDispatchContext {
  req: Request;
  requestContext: RequestContext;
}

export interface JsonRpcMethodDispatchDependencies {
  agentCard: AgentCard;
  taskManager: TaskManager;
  authMiddleware: JwtAuthMiddleware | undefined;
  normalizePushNotificationConfig(config: PushNotificationConfig): Promise<PushNotificationConfig>;
  handleMessageRequest(params: MessageSendParams, method: string, req: Request): Promise<Task>;
}

export async function dispatchJsonRpcMethod(
  req: JsonRpcRequest,
  context: JsonRpcMethodDispatchContext,
  deps: JsonRpcMethodDispatchDependencies,
): Promise<unknown> {
  const params = (req.params ?? {}) as Record<string, unknown>;
  switch (req.method) {
    case 'message/send':
      return deps.handleMessageRequest(validateMessageSendParams(params), req.method, context.req);

    case 'message/stream':
    case 'tasks/resubscribe':
      throw new JsonRpcError(
        ErrorCodes.UnsupportedOperation,
        `${req.method} requires an SSE response transport`,
      );

    case 'tasks/get':
      return trimTaskHistory(
        getTaskOrThrow(
          params['taskId'],
          deps.taskManager,
          context.requestContext,
          (task, requestContext) => canAccessTask(task, requestContext, deps.authMiddleware),
        ),
        selectHistoryLength(params),
      );

    case 'tasks/cancel': {
      const existingTask = getTaskOrThrow(
        params['taskId'],
        deps.taskManager,
        context.requestContext,
        (task, requestContext) => canAccessTask(task, requestContext, deps.authMiddleware),
      );
      const task = deps.taskManager.cancelTask(existingTask.id);
      if (!task) {
        throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
      }
      return task;
    }

    case 'tasks/pushNotification/set':
    case 'tasks/pushNotificationConfig/create':
      return setPushNotificationConfig(req.method, params, context, deps);

    case 'tasks/pushNotification/get':
    case 'tasks/pushNotificationConfig/get': {
      const task = getTaskOrThrow(
        selectPushTaskId(params),
        deps.taskManager,
        context.requestContext,
        (candidate, requestContext) =>
          canAccessTask(candidate, requestContext, deps.authMiddleware),
      );
      const configId =
        req.method === 'tasks/pushNotificationConfig/get'
          ? selectPushConfigId(params)
          : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
      return deps.taskManager.getPushNotificationConfig(task.id, configId) ?? null;
    }

    case 'tasks/pushNotificationConfig/list': {
      const task = getTaskOrThrow(
        selectPushTaskId(params),
        deps.taskManager,
        context.requestContext,
        (candidate, requestContext) =>
          canAccessTask(candidate, requestContext, deps.authMiddleware),
      );
      return { configs: deps.taskManager.listPushNotifications(task.id) };
    }

    case 'tasks/pushNotificationConfig/delete': {
      const task = getTaskOrThrow(
        selectPushTaskId(params),
        deps.taskManager,
        context.requestContext,
        (candidate, requestContext) =>
          canAccessTask(candidate, requestContext, deps.authMiddleware),
      );
      const configId = selectPushConfigId(params);
      return { deleted: deps.taskManager.removePushNotificationConfig(task.id, configId) };
    }

    case 'tasks/list': {
      const { contextId, limit = 50, offset = 0 } = validateTaskListParams(params);
      let tasks = contextId
        ? deps.taskManager.getTasksByContext(contextId)
        : deps.taskManager.getAllTasks();
      tasks = filterTasksByContext(tasks, context.requestContext, deps.authMiddleware);
      return {
        tasks: tasks.slice(offset, offset + limit),
        total: tasks.length,
      };
    }

    case 'agent/getAuthenticatedExtendedCard':
    case 'agent/authenticatedExtendedCard':
      if (!deps.agentCard.capabilities?.extendedAgentCard) {
        throw new JsonRpcError(ErrorCodes.UnsupportedOperation, 'Extended card not supported');
      }
      if (!deps.authMiddleware) {
        throw new JsonRpcError(
          ErrorCodes.Unauthorized,
          'Authenticated extended card requires authentication',
        );
      }
      return deps.agentCard;

    default:
      throw new JsonRpcError(
        ErrorCodes.MethodNotFound,
        `Method ${req.method} not found`,
        makeErrorInfo('METHOD_NOT_FOUND'),
      );
  }
}

async function setPushNotificationConfig(
  method: 'tasks/pushNotification/set' | 'tasks/pushNotificationConfig/create',
  params: Record<string, unknown>,
  context: JsonRpcMethodDispatchContext,
  deps: JsonRpcMethodDispatchDependencies,
): Promise<PushNotificationConfig | undefined> {
  const rawPushNotificationConfig =
    method === 'tasks/pushNotificationConfig/create'
      ? selectRawTaskPushNotificationConfig(params)
      : selectRawPushConfig(params);
  if (!rawPushNotificationConfig || typeof rawPushNotificationConfig !== 'object') {
    throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId or callback config');
  }
  const task = getTaskOrThrow(
    selectPushTaskId(params),
    deps.taskManager,
    context.requestContext,
    (candidate, requestContext) => canAccessTask(candidate, requestContext, deps.authMiddleware),
  );
  const pushNotificationConfig = validateRequest(
    PushNotificationConfigSchema,
    rawPushNotificationConfig,
  ) as PushNotificationConfig;
  const normalizedPushNotificationConfig =
    await deps.normalizePushNotificationConfig(pushNotificationConfig);
  const configId =
    method === 'tasks/pushNotificationConfig/create'
      ? selectPushConfigId(params, normalizedPushNotificationConfig)
      : pushNotificationConfigId(normalizedPushNotificationConfig);
  return deps.taskManager.setPushNotificationConfig(
    task.id,
    configId,
    normalizedPushNotificationConfig,
  );
}

function selectHistoryLength(params: Record<string, unknown>): number | undefined {
  const raw = params['historyLength'] ?? params['history_length'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new JsonRpcError(
      ErrorCodes.InvalidParams,
      'historyLength must be a non-negative integer',
    );
  }
  return raw;
}

function trimTaskHistory(task: Task, historyLength: number | undefined): Task {
  if (historyLength === undefined) return task;
  return {
    ...task,
    history: historyLength === 0 ? [] : task.history.slice(-historyLength),
  };
}

export function getTaskOrThrow(
  taskId: unknown,
  taskManager: TaskManager,
  requestContext: RequestContext,
  canAccessTaskFn: (task: Task, context: RequestContext) => boolean,
): Task {
  if (typeof taskId !== 'string') {
    throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
  }
  const task = taskManager.getTask(taskId);
  if (!task) {
    throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
  }
  if (!canAccessTaskFn(task, requestContext)) {
    throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
  }
  return task;
}

export function filterTasksByContext(
  tasks: Task[],
  context: RequestContext,
  authMiddleware: JwtAuthMiddleware | undefined,
): Task[] {
  if (!shouldEnforceTaskOwnership(context, authMiddleware)) {
    return tasks;
  }
  return tasks.filter((task) => canAccessTask(task, context, authMiddleware));
}

export function canAccessTask(
  task: Task,
  context: RequestContext,
  authMiddleware: JwtAuthMiddleware | undefined,
): boolean {
  if (!shouldEnforceTaskOwnership(context, authMiddleware)) {
    return true;
  }
  if (!context.principalId || !task.principalId || task.principalId !== context.principalId) {
    return false;
  }
  if (context.tenantId || task.tenantId) {
    return Boolean(context.tenantId && task.tenantId && task.tenantId === context.tenantId);
  }
  return true;
}

function selectRawPushConfig(params: Record<string, unknown>): unknown {
  return (
    params['taskPushNotificationConfig'] ??
    params['task_push_notification_config'] ??
    params['pushNotificationConfig']
  );
}

function selectPushTaskId(params: Record<string, unknown>): unknown {
  const wrapped = params['taskPushNotificationConfig'];
  if (wrapped && typeof wrapped === 'object' && 'taskId' in wrapped) {
    return (wrapped as Record<string, unknown>)['taskId'];
  }
  return params['taskId'];
}

function selectPushConfigId(
  params: Record<string, unknown>,
  config?: Pick<PushNotificationConfig, 'id'>,
): string {
  const rawId = params['configId'] ?? params['id'] ?? config?.id;
  return typeof rawId === 'string' && rawId.trim().length > 0
    ? rawId.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}

function selectRawTaskPushNotificationConfig(params: Record<string, unknown>): unknown {
  const wrapped = params['taskPushNotificationConfig'];
  if (wrapped && typeof wrapped === 'object' && 'pushNotificationConfig' in wrapped) {
    return (wrapped as Record<string, unknown>)['pushNotificationConfig'];
  }
  return selectRawPushConfig(params);
}

function shouldEnforceTaskOwnership(
  context: RequestContext,
  authMiddleware: JwtAuthMiddleware | undefined,
): boolean {
  return Boolean(authMiddleware) || context.authMethod !== 'anonymous';
}

function pushNotificationConfigId(config: PushNotificationConfig): string {
  return config.id && config.id.trim().length > 0
    ? config.id.trim()
    : DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}
