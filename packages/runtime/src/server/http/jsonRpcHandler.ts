import type { Request, RequestHandler, Response } from 'express';
import type { JwtAuthMiddleware } from '../../auth/index.js';
import { getRequestContext } from '../../auth/index.js';
import { a2aMeshTracer, SpanStatusCode } from '../../telemetry/index.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import type { AgentCard } from '../../types/agent-card.js';
import { getDocsUrl } from '../../config/docs.js';
import type { RequestContext } from '../../types/auth.js';
import type { A2AExtension } from '../../types/extensions.js';
import {
  ErrorCodes,
  JsonRpcError,
  type JsonRpcFailureResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
} from '../../types/jsonrpc.js';
import type {
  Artifact,
  ExtensibleArtifact,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
} from '../../types/task.js';
import { normalizeMessage } from '../../utils/compat.js';
import { logger } from '../../utils/logger.js';
import {
  PushNotificationConfigSchema,
  validateJsonRpcRequest,
  validateMessageSendParams,
  validateRequest,
  validateTaskListParams,
} from '../../utils/schema-validator.js';
import type { IdempotencyStore } from '../IdempotencyStore.js';
import { TaskLifecycleError, type TaskManager } from '../TaskManager.js';
import {
  decorateIdempotentResult,
  extractJsonRpcId,
  resolveIdempotency,
  type IdempotencyResolution,
} from './idempotency.js';
import { toLifecycleJsonRpcError } from './lifecycleErrors.js';
import type { RequestWithRequestId } from './middleware.js';
import { isStreamingRpcMethod } from './streamRoutes.js';
import { assertSupportedA2AProtocolVersion } from './protocolVersion.js';

export interface RpcContext {
  req: Request;
  requestContext: RequestContext;
}

export type HandleRpc = (rpcReq: JsonRpcRequest, context: RpcContext) => Promise<unknown>;

export type HandleStreamingRpc = (
  rpcReq: JsonRpcRequest,
  context: RpcContext,
  res: Response,
  idempotency?: IdempotencyResolution,
) => Promise<void>;

type NormalizePushNotificationConfig = (
  config: PushNotificationConfig,
) => Promise<PushNotificationConfig>;

type ProcessTask = (task: Task, message: Message, signal?: AbortSignal) => Promise<void>;

export interface MessageRequestDependencies {
  agentCard: AgentCard;
  taskManager: TaskManager;
  authMiddleware: JwtAuthMiddleware | undefined;
  normalizePushNotificationConfig: NormalizePushNotificationConfig;
  processTask: ProcessTask;
}

export interface RpcHandlerDependencies extends MessageRequestDependencies {
  runtimeMetrics: RuntimeMetrics;
}

export interface JsonRpcHttpHandlerDependencies {
  authMiddleware: JwtAuthMiddleware | undefined;
  runtimeMetrics: RuntimeMetrics;
  idempotencyStore: IdempotencyStore;
  idempotencyTtlMs: number;
  handleRpc: HandleRpc;
  handleStreamingRpc: HandleStreamingRpc;
}

export function createJsonRpcSuccessResponse<T>(
  result: T,
  id: JsonRpcId,
): JsonRpcSuccessResponse<T> {
  return {
    jsonrpc: '2.0',
    result,
    id,
  };
}

export function createJsonRpcErrorResponse(
  error: Pick<JsonRpcError, 'code' | 'message' | 'data'>,
  id: JsonRpcId,
): JsonRpcFailureResponse {
  return {
    jsonrpc: '2.0',
    error: {
      code: error.code,
      message: error.message,
      ...(error.data ? { data: error.data } : {}),
    },
    id,
  };
}

export function createJsonRpcHttpHandler(deps: JsonRpcHttpHandlerDependencies): RequestHandler {
  return async (req, res) => {
    let idempotency: IdempotencyResolution | null | undefined;
    try {
      assertSupportedA2AProtocolVersion(req);

      if (Array.isArray(req.body)) {
        throw new JsonRpcError(ErrorCodes.InvalidRequest, 'Batch requests are not supported');
      }

      const rpcReq = validateJsonRpcRequest(req.body);
      let requestContext = getRequestContext(req);
      if (deps.authMiddleware) {
        try {
          requestContext = await deps.authMiddleware.authenticateRequestContext(req);
        } catch (error: unknown) {
          deps.runtimeMetrics.recordAuthReject();
          throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized', {
            reason: String(error),
          });
        }
      }

      idempotency = await resolveIdempotency(
        req,
        rpcReq,
        requestContext,
        res,
        deps.idempotencyStore,
        isStreamingRpcMethod(rpcReq.method),
      );
      if (idempotency === null) {
        return;
      }

      if (isStreamingRpcMethod(rpcReq.method)) {
        await deps.handleStreamingRpc(
          rpcReq,
          { req, requestContext },
          res,
          idempotency ?? undefined,
        );
        return;
      }

      const result = await deps.handleRpc(rpcReq, { req, requestContext });
      const responseResult = idempotency
        ? decorateIdempotentResult(result, idempotency, false)
        : result;
      if (idempotency) {
        await deps.idempotencyStore.set(
          idempotency.scope,
          idempotency.key,
          idempotency.fingerprint,
          {
            kind: 'success',
            value: structuredClone(responseResult),
          },
          deps.idempotencyTtlMs,
        );
      }
      res.json(createJsonRpcSuccessResponse(responseResult, rpcReq.id ?? null));
    } catch (err: unknown) {
      await writeJsonRpcErrorResponse(req, res, err, idempotency, deps);
    }
  };
}

async function writeJsonRpcErrorResponse(
  req: Request,
  res: Response,
  err: unknown,
  idempotency: IdempotencyResolution | null | undefined,
  deps: Pick<JsonRpcHttpHandlerDependencies, 'idempotencyStore' | 'idempotencyTtlMs'>,
): Promise<void> {
  const responseId = extractJsonRpcId(req.body);
  if (err instanceof JsonRpcError) {
    if (idempotency && err.code !== ErrorCodes.IdempotencyConflict) {
      const error = {
        code: err.code,
        message: err.message,
        ...(err.data ? { data: err.data } : {}),
      };
      await deps.idempotencyStore.set(
        idempotency.scope,
        idempotency.key,
        idempotency.fingerprint,
        {
          kind: 'error',
          error,
        },
        deps.idempotencyTtlMs,
      );
    }
    res.json(createJsonRpcErrorResponse(err, responseId));
    return;
  }

  logger.error('Unhandled internal error', { error: String(err) });
  res.json(
    createJsonRpcErrorResponse(
      new JsonRpcError(ErrorCodes.InternalError, 'Internal Error'),
      responseId,
    ),
  );
}

type MessageRequestConfiguration = NonNullable<MessageSendParams['configuration']>;

function selectPushConfig(
  configuration: MessageRequestConfiguration | undefined,
): PushNotificationConfig | undefined {
  return (
    configuration?.taskPushNotificationConfig ??
    configuration?.task_push_notification_config ??
    configuration?.pushNotificationConfig
  );
}

function selectRawPushConfig(params: Record<string, unknown>): unknown {
  return (
    params['taskPushNotificationConfig'] ??
    params['task_push_notification_config'] ??
    params['pushNotificationConfig']
  );
}

const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

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

function shouldReturnImmediately(configuration: MessageRequestConfiguration | undefined): boolean {
  if (typeof configuration?.returnImmediately === 'boolean') return configuration.returnImmediately;
  if (typeof configuration?.return_immediately === 'boolean')
    return configuration.return_immediately;
  if (typeof configuration?.blocking === 'boolean') return !configuration.blocking;
  return false;
}

function resolveHistoryLimit(
  configuration: MessageRequestConfiguration | undefined,
): number | undefined {
  const raw = configuration?.historyLength ?? configuration?.history_length;
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 0) {
    throw new JsonRpcError(
      ErrorCodes.InvalidParams,
      'history limit must be a non-negative integer',
    );
  }
  return raw;
}

function trimTaskHistory(task: Task, limit: number | undefined): Task {
  if (limit === undefined) return task;
  return { ...task, history: limit === 0 ? [] : task.history.slice(-limit) };
}

function snapshotTask(task: Task): Task {
  return {
    ...task,
    status: { ...task.status },
    history: task.history.map((message) => ({ ...message, parts: [...message.parts] })),
    artifacts: (task.artifacts ?? []).map((artifact) => ({
      ...artifact,
      parts: [...artifact.parts],
    })),
    extensions: [...(task.extensions ?? [])],
    metadata: { ...(task.metadata ?? {}) },
  };
}

async function waitForTaskProcessing(
  task: Task,
  message: Message,
  signal: AbortSignal | undefined,
  deps: MessageRequestDependencies,
): Promise<void> {
  try {
    await deps.processTask(task, message, signal);
  } catch (error) {
    logger.error('Task processing failed', {
      taskId: task.id,
      ...(task.contextId ? { contextId: task.contextId } : {}),
      error,
    });
  }
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

export async function handleRpcRequest(
  req: JsonRpcRequest,
  context: RpcContext,
  deps: RpcHandlerDependencies,
): Promise<unknown> {
  const span = a2aMeshTracer.startSpan('a2a.handleRpc', {
    attributes: {
      'rpc.method': req.method,
      'a2a.agent_name': deps.agentCard.name,
    },
  });
  const requestId = (context.req as RequestWithRequestId).requestId;
  const startedAt = Date.now();
  let failed = false;

  try {
    const params = (req.params ?? {}) as Record<string, unknown>;
    switch (req.method) {
      case 'message/send':
        return await handleMessageRequest(
          validateMessageSendParams(params),
          req.method,
          context.req,
          undefined,
          deps,
        );

      case 'message/stream':
      case 'tasks/resubscribe':
        throw new JsonRpcError(
          ErrorCodes.UnsupportedOperation,
          `${req.method} requires an SSE response transport`,
        );

      case 'tasks/get': {
        return getTaskOrThrow(
          params['taskId'],
          deps.taskManager,
          context.requestContext,
          (t, ctx) => canAccessTask(t, ctx, deps.authMiddleware),
        );
      }

      case 'tasks/cancel': {
        const existingTask = getTaskOrThrow(
          params['taskId'],
          deps.taskManager,
          context.requestContext,
          (t, ctx) => canAccessTask(t, ctx, deps.authMiddleware),
        );
        const task = deps.taskManager.cancelTask(existingTask.id);
        if (!task) {
          throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
        }
        return task;
      }

      case 'tasks/pushNotification/set':
      case 'tasks/pushNotificationConfig/create': {
        const rawPushNotificationConfig =
          req.method === 'tasks/pushNotificationConfig/create'
            ? selectRawTaskPushNotificationConfig(params)
            : selectRawPushConfig(params);
        if (!rawPushNotificationConfig || typeof rawPushNotificationConfig !== 'object') {
          throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId or callback config');
        }
        const task = getTaskOrThrow(
          selectPushTaskId(params),
          deps.taskManager,
          context.requestContext,
          (t, ctx) => canAccessTask(t, ctx, deps.authMiddleware),
        );
        const pushNotificationConfig = validateRequest(
          PushNotificationConfigSchema,
          rawPushNotificationConfig,
        ) as PushNotificationConfig;
        const normalizedPushNotificationConfig =
          await deps.normalizePushNotificationConfig(pushNotificationConfig);
        const configId =
          req.method === 'tasks/pushNotificationConfig/create'
            ? selectPushConfigId(params, normalizedPushNotificationConfig)
            : pushNotificationConfigId(normalizedPushNotificationConfig);
        return deps.taskManager.setPushNotificationConfig(
          task.id,
          configId,
          normalizedPushNotificationConfig,
        );
      }

      case 'tasks/pushNotification/get':
      case 'tasks/pushNotificationConfig/get': {
        const task = getTaskOrThrow(
          selectPushTaskId(params),
          deps.taskManager,
          context.requestContext,
          (t, ctx) => canAccessTask(t, ctx, deps.authMiddleware),
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
          (t, ctx) => canAccessTask(t, ctx, deps.authMiddleware),
        );
        return { configs: deps.taskManager.listPushNotifications(task.id) };
      }

      case 'tasks/pushNotificationConfig/delete': {
        const task = getTaskOrThrow(
          selectPushTaskId(params),
          deps.taskManager,
          context.requestContext,
          (t, ctx) => canAccessTask(t, ctx, deps.authMiddleware),
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
      case 'agent/authenticatedExtendedCard': {
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
      }

      default:
        throw new JsonRpcError(ErrorCodes.MethodNotFound, `Method ${req.method} not found`);
    }
  } catch (error: unknown) {
    if (error instanceof TaskLifecycleError) {
      throw toLifecycleJsonRpcError(error);
    }
    failed = true;
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    throw error;
  } finally {
    if (!failed) {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
    logger.info('Handled RPC request', {
      ...(requestId ? { requestId } : {}),
      ...(context.requestContext.principalId
        ? { principalId: context.requestContext.principalId }
        : {}),
      ...(context.requestContext.tenantId ? { tenantId: context.requestContext.tenantId } : {}),
      method: req.method,
      agentName: deps.agentCard.name,
      durationMs: Date.now() - startedAt,
    });
  }
}

function assertMessageContextMatchesTask(params: MessageSendParams, task: Task): void {
  const requestedContextId = params.contextId ?? params.message.contextId;
  if (requestedContextId === undefined) {
    return;
  }

  if (requestedContextId !== task.contextId) {
    throw new JsonRpcError(ErrorCodes.InvalidParams, 'contextId does not match task contextId', {
      taskId: task.id,
      requestedContextId,
      taskContextId: task.contextId ?? '',
    });
  }
}

export async function handleMessageRequest(
  params: MessageSendParams,
  method: string,
  req: Request | undefined,
  signal: AbortSignal | undefined,
  deps: MessageRequestDependencies,
): Promise<Task> {
  const requestContext = req ? getRequestContext(req) : undefined;
  const principalId = requestContext?.principalId;
  const tenantId = requestContext?.tenantId;

  let task: Task;

  if (params.taskId) {
    const existingTask = deps.taskManager.getTask(params.taskId);
    if (!existingTask) {
      throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
    }
    task = existingTask;
    if (requestContext && !canAccessTask(task, requestContext, deps.authMiddleware)) {
      throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
    }
    assertMessageContextMatchesTask(params, task);
  } else {
    task = deps.taskManager.createTask(
      params.sessionId,
      params.contextId ?? params.message.contextId,
      principalId,
      tenantId,
    );
    logger.audit(
      'task_created',
      principalId,
      `task:${task.id}`,
      'success',
      tenantId ? { tenantId } : {},
    );
  }

  const selectedPushConfig = selectPushConfig(params.configuration);
  const pushNotificationConfig = selectedPushConfig
    ? await deps.normalizePushNotificationConfig(selectedPushConfig)
    : undefined;

  const appliedExtensions = negotiateExtensions(
    deps.agentCard,
    params.configuration?.extensions ?? [],
  );
  deps.taskManager.setTaskExtensions(task.id, appliedExtensions);
  if (pushNotificationConfig) {
    deps.taskManager.setPushNotification(task.id, pushNotificationConfig);
  }

  const message = normalizeMessage({
    ...params.message,
    kind: params.message.kind ?? 'message',
    ...((params.message.contextId ?? task.contextId)
      ? { contextId: params.message.contextId ?? task.contextId }
      : {}),
  });
  deps.taskManager.addHistoryMessage(task.id, message);
  deps.taskManager.updateTaskState(task.id, 'WORKING');

  const returnImmediately =
    method === 'message/stream' || shouldReturnImmediately(params.configuration);
  const historyLimit = resolveHistoryLimit(params.configuration);

  if (returnImmediately) {
    const immediateTask = trimTaskHistory(snapshotTask(task), historyLimit);
    void waitForTaskProcessing(task, message, undefined, deps);
    return immediateTask;
  }

  await waitForTaskProcessing(task, message, signal, deps);
  return trimTaskHistory(deps.taskManager.getTask(task.id) ?? task, historyLimit);
}

function negotiateExtensions(agentCard: AgentCard, requestedExtensions: A2AExtension[]): string[] {
  if (requestedExtensions.length === 0) {
    return [];
  }

  const supported = new Set((agentCard.extensions ?? []).map((extension) => extension.uri));
  const applied: string[] = [];
  for (const extension of requestedExtensions) {
    if (supported.has(extension.uri)) {
      applied.push(extension.uri);
      continue;
    }

    if (extension.required) {
      throw new JsonRpcError(
        ErrorCodes.ExtensionRequired,
        `Required extension not supported: ${extension.uri}. See: ${getDocsUrl('protocol/extensions')}`,
      );
    }
  }

  return applied;
}

export function normalizeArtifacts(task: Task, artifacts: Artifact[]): ExtensibleArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    ...(((artifact as ExtensibleArtifact).extensions ?? task.extensions)
      ? { extensions: (artifact as ExtensibleArtifact).extensions ?? task.extensions }
      : {}),
    metadata: {
      ...((artifact as ExtensibleArtifact).metadata ?? {}),
      taskId: task.id,
      ...(task.contextId ? { contextId: task.contextId } : {}),
      appliedExtensions: task.extensions ?? [],
    },
  }));
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
