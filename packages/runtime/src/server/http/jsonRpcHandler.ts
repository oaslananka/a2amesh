import type { Request, RequestHandler, Response } from 'express';
import type { JwtAuthMiddleware } from '../../auth/index.js';
import { getRequestContext } from '../../auth/index.js';
import { a2aMeshTracer, SpanStatusCode } from '../../telemetry/index.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import type { AgentCard } from '../../types/agent-card.js';
import { getDocsUrl } from '../../config/docs.js';
import type { RequestContext } from '../../types/auth.js';
import type { A2AExtension } from '../../types/extensions.js';
import { ErrorCodes, JsonRpcError, type JsonRpcRequest } from '../../types/jsonrpc.js';
import type {
  Artifact,
  ExtensibleArtifact,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
} from '../../types/task.js';
import { normalizeMessage } from '../../utils/compat.js';
import { toOfficialV1RpcResult, type A2AJsonRpcDialect } from '../../utils/officialWire.js';
import { logger } from '../../utils/logger.js';
import type { JsonRpcInputLimits } from '../../utils/json-rpc-input-limits.js';
import type { IdempotencyStore } from '../IdempotencyStore.js';
import { TaskLifecycleError, type TaskManager } from '../TaskManager.js';
import type { IdempotencyResolution } from './idempotency.js';
import {
  executeJsonRpcIdempotentRequest,
  resolveJsonRpcExecutionIdempotency,
} from './jsonRpcIdempotencyExecution.js';
import { canAccessTask, dispatchJsonRpcMethod } from './jsonRpcMethodDispatch.js';
import { toLifecycleJsonRpcError } from './lifecycleErrors.js';
import type { RequestWithRequestId } from './middleware.js';
import { isStreamingRpcMethod } from './streamRoutes.js';
import { prepareJsonRpcRequest } from './jsonRpcEnvelope.js';
import { resolveJsonRpcRequestContext } from './jsonRpcRequestContext.js';
import { createJsonRpcSuccessResponse, writeJsonRpcErrorResponse } from './jsonRpcResponses.js';
export { createJsonRpcErrorResponse, createJsonRpcSuccessResponse } from './jsonRpcResponses.js';
export { canAccessTask, filterTasksByContext, getTaskOrThrow } from './jsonRpcMethodDispatch.js';

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
  responseDialect?: A2AJsonRpcDialect,
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
  idempotencyLeaseMs: number;
  jsonRpcInputLimits?: JsonRpcInputLimits;
  handleRpc: HandleRpc;
  handleStreamingRpc: HandleStreamingRpc;
}

export function createJsonRpcHttpHandler(deps: JsonRpcHttpHandlerDependencies): RequestHandler {
  return async (req, res) => {
    let idempotency: IdempotencyResolution | null | undefined;
    try {
      const { receivedRpcReq, rpcReq, responseDialect } = prepareJsonRpcRequest(
        req,
        deps.jsonRpcInputLimits,
      );
      const requestContext = await resolveJsonRpcRequestContext(
        req,
        deps.authMiddleware,
        deps.runtimeMetrics,
      );

      idempotency = await resolveJsonRpcExecutionIdempotency(req, rpcReq, requestContext, res, {
        store: deps.idempotencyStore,
        leaseMs: deps.idempotencyLeaseMs,
        runtimeMetrics: deps.runtimeMetrics,
      });
      if (idempotency === null) {
        return;
      }

      if (isStreamingRpcMethod(rpcReq.method)) {
        await deps.handleStreamingRpc(
          rpcReq,
          { req, requestContext },
          res,
          idempotency ?? undefined,
          responseDialect,
        );
        return;
      }

      const responseResult = await executeJsonRpcIdempotentRequest(
        rpcReq,
        idempotency,
        () => deps.handleRpc(rpcReq, { req, requestContext }),
        {
          store: deps.idempotencyStore,
          ttlMs: deps.idempotencyTtlMs,
          runtimeMetrics: deps.runtimeMetrics,
        },
      );
      const wireResult =
        responseDialect === 'official-v1'
          ? toOfficialV1RpcResult(receivedRpcReq.method, responseResult)
          : responseResult;
      res.json(createJsonRpcSuccessResponse(wireResult, rpcReq.id ?? null));
    } catch (err: unknown) {
      await writeJsonRpcErrorResponse(req, res, err, idempotency, {
        store: deps.idempotencyStore,
        ttlMs: deps.idempotencyTtlMs,
      });
    }
  };
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
    return await dispatchJsonRpcMethod(req, context, {
      agentCard: deps.agentCard,
      taskManager: deps.taskManager,
      authMiddleware: deps.authMiddleware,
      normalizePushNotificationConfig: deps.normalizePushNotificationConfig,
      handleMessageRequest: (params, method, request) =>
        handleMessageRequest(params, method, request, undefined, deps),
    });
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
