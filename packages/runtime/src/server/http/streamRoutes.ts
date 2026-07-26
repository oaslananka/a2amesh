import type { Express, Request, Response } from 'express';
import type { JwtAuthMiddleware } from '../../auth/index.js';
import { getRequestContext } from '../../auth/index.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import { type JsonRpcRequest, type JsonRpcResponse } from '../../types/jsonrpc.js';
import type { RequestContext } from '../../types/auth.js';
import type { MessageSendParams, Task } from '../../types/task.js';
import { logger } from '../../utils/logger.js';
import { toOfficialV1StreamResult, type A2AJsonRpcDialect } from '../../utils/officialWire.js';
import { validateMessageSendParams } from '../../utils/schema-validator.js';
import type { IdempotencyStoredResult, IdempotencyStore } from '../IdempotencyStore.js';
import type { SSEStreamer } from '../SSEStreamer.js';
import type { TaskManager, TaskUpdatedEvent } from '../TaskManager.js';
import {
  completeIdempotency,
  decorateIdempotentResult,
  startIdempotencyLease,
  type IdempotencyResolution,
} from './idempotency.js';
import {
  A2A_VERSION_NOT_SUPPORTED_PROBLEM_TYPE,
  SUPPORTED_A2A_PROTOCOL_VERSIONS,
  assertSupportedA2AProtocolVersion,
} from './protocolVersion.js';
import { getTaskOrThrow } from './jsonRpcHandler.js';
import { isTerminalTaskState } from './lifecycleErrors.js';

export const STREAM_PATHS = ['/stream', '/a2a/stream'] as const;

type CanAccessTask = (task: Task, context: RequestContext) => boolean;

type StreamingMessageHandler = (
  params: MessageSendParams,
  method: string,
  req: Request,
  signal?: AbortSignal,
) => Promise<Task>;

export interface StreamSubscriptionDependencies {
  taskManager: TaskManager;
  streamer: SSEStreamer;
  runtimeMetrics: RuntimeMetrics;
  authMiddleware: JwtAuthMiddleware | undefined;
  canAccessTask: CanAccessTask;
}

export interface StreamingRpcDependencies {
  taskManager: TaskManager;
  runtimeMetrics: RuntimeMetrics;
  idempotencyStore: IdempotencyStore;
  idempotencyTtlMs: number;
  canAccessTask: CanAccessTask;
  handleMessageRequest: StreamingMessageHandler;
}

export interface StreamingRpcContext {
  req: Request;
  requestContext: RequestContext;
}

export function isStreamingRpcMethod(method: string): boolean {
  return method === 'message/stream' || method === 'tasks/resubscribe';
}

export async function authenticateRequestOrSend401(
  req: Request,
  res: Response,
  authMiddleware: JwtAuthMiddleware | undefined,
  runtimeMetrics: RuntimeMetrics,
): Promise<RequestContext | null> {
  let requestContext = getRequestContext(req);
  if (authMiddleware) {
    try {
      requestContext = await authMiddleware.authenticateRequestContext(req);
    } catch {
      runtimeMetrics.recordAuthReject();
      res.status(401).send('Unauthorized');
      return null;
    }
  }
  return requestContext;
}

export function registerStreamRoutes(app: Express, deps: StreamSubscriptionDependencies): void {
  const handler = async (req: Request, res: Response) => handleStreamRequest(req, res, deps);
  for (const path of STREAM_PATHS) {
    app.get(path, handler);
  }
}

function assertStreamProtocolVersionOrSendProblem(req: Request, res: Response): boolean {
  try {
    assertSupportedA2AProtocolVersion(req);
    return true;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Protocol version is not supported';
    res
      .status(400)
      .type('application/problem+json')
      .json({
        type: A2A_VERSION_NOT_SUPPORTED_PROBLEM_TYPE,
        title: 'Protocol Version Not Supported',
        status: 400,
        detail,
        supportedVersions: [...SUPPORTED_A2A_PROTOCOL_VERSIONS],
      });
    return false;
  }
}

async function handleStreamRequest(
  req: Request,
  res: Response,
  deps: StreamSubscriptionDependencies,
): Promise<void> {
  if (!assertStreamProtocolVersionOrSendProblem(req, res)) {
    return;
  }

  const requestContext = await authenticateRequestOrSend401(
    req,
    res,
    deps.authMiddleware,
    deps.runtimeMetrics,
  );
  if (!requestContext) {
    return;
  }

  const taskId = req.query['taskId'];
  if (typeof taskId !== 'string') {
    res.status(400).send('Missing taskId query parameter');
    return;
  }

  const task = deps.taskManager.getTask(taskId);
  if (!task) {
    res.status(404).send('Task not found');
    return;
  }

  if (!deps.canAccessTask(task, requestContext)) {
    res.status(403).send('Forbidden');
    return;
  }

  deps.runtimeMetrics.recordSseConnectionOpened(Boolean(req.header('last-event-id')));
  deps.streamer.addClient(taskId, res, () => {
    deps.runtimeMetrics.recordSseConnectionClosed();
  });
  deps.streamer.sendTaskUpdate(taskId, task);
}

function initSseResponse(req: Request, res: Response, runtimeMetrics: RuntimeMetrics): void {
  runtimeMetrics.recordSseConnectionOpened(Boolean(req.header('last-event-id')));
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

export async function handleStreamingRpc(
  rpcReq: JsonRpcRequest,
  context: StreamingRpcContext,
  res: Response,
  idempotency: IdempotencyResolution | undefined,
  deps: StreamingRpcDependencies,
  responseDialect: A2AJsonRpcDialect = 'mesh',
): Promise<void> {
  const responseId = rpcReq.id ?? null;
  const replay = idempotency?.replay;
  if (idempotency && replay) {
    writeStreamingReplay(
      rpcReq,
      context,
      res,
      { ...idempotency, replay },
      deps.runtimeMetrics,
      responseDialect,
    );
    return;
  }

  let task: Task;
  const abortController = new AbortController();
  context.req.on('close', () => abortController.abort());
  const lease = startIdempotencyLease(
    idempotency,
    deps.idempotencyStore,
    deps.runtimeMetrics,
    rpcReq.method,
  );

  try {
    if (rpcReq.method === 'message/stream') {
      task = await deps.handleMessageRequest(
        validateMessageSendParams((rpcReq.params ?? {}) as Record<string, unknown>),
        rpcReq.method,
        context.req,
        abortController.signal,
      );
      if (idempotency) {
        await completeIdempotency(
          deps.idempotencyStore,
          idempotency,
          {
            kind: 'success',
            value: structuredClone(decorateIdempotentResult(task, idempotency, false)),
          },
          deps.idempotencyTtlMs,
        );
      }
    } else {
      const params = (rpcReq.params ?? {}) as Record<string, unknown>;
      task = getTaskOrThrow(
        params['taskId'],
        deps.taskManager,
        context.requestContext,
        deps.canAccessTask,
      );
    }
  } finally {
    lease?.stop();
  }

  initSseResponse(context.req, res, deps.runtimeMetrics);

  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    deps.runtimeMetrics.recordSseConnectionClosed();
    deps.taskManager.off('taskUpdated', onTaskUpdated);
    res.end();
  };

  const writeTask = (nextTask: Task): void => {
    if (closed) {
      return;
    }
    const response: JsonRpcResponse<unknown> = {
      jsonrpc: '2.0',
      result: responseDialect === 'official-v1' ? toOfficialV1StreamResult(nextTask) : nextTask,
      id: responseId,
    };
    try {
      res.write(createSseJsonRpcFrame(response));
    } catch {
      close();
      return;
    }
    if (isTerminalTaskState(nextTask.status.state)) {
      close();
    }
  };

  const onTaskUpdated = ({ task: updatedTask }: TaskUpdatedEvent) => {
    if (updatedTask.id === task.id) {
      writeTask(updatedTask);
    }
  };

  context.req.on('close', close);
  deps.taskManager.on('taskUpdated', onTaskUpdated);
  writeTask(deps.taskManager.getTask(task.id) ?? task);
}

function writeStreamingReplay(
  rpcReq: JsonRpcRequest,
  context: StreamingRpcContext,
  res: Response,
  idempotency: IdempotencyResolution & { replay: IdempotencyStoredResult },
  runtimeMetrics: RuntimeMetrics,
  responseDialect: A2AJsonRpcDialect,
): void {
  initSseResponse(context.req, res, runtimeMetrics);

  const response: JsonRpcResponse =
    idempotency.replay.kind === 'error'
      ? {
          jsonrpc: '2.0',
          error: idempotency.replay.error,
          id: rpcReq.id ?? null,
        }
      : {
          jsonrpc: '2.0',
          result:
            responseDialect === 'official-v1' &&
            idempotency.replay.value &&
            typeof idempotency.replay.value === 'object' &&
            'status' in idempotency.replay.value
              ? toOfficialV1StreamResult(idempotency.replay.value as Task)
              : decorateIdempotentResult(idempotency.replay.value, idempotency, true),
          id: rpcReq.id ?? null,
        };

  try {
    try {
      res.write(createSseJsonRpcFrame(response));
    } catch (error) {
      logger.warn('Failed to write JSON-RPC SSE replay', { error });
    }
  } finally {
    runtimeMetrics.recordSseConnectionClosed();
    res.end();
  }
}

function createSseJsonRpcFrame(response: JsonRpcResponse): string {
  return `event: message\ndata: ${JSON.stringify(response)}\n\n`;
}
