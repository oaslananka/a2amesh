import type { Express, Request, Response } from 'express';
import type { JwtAuthMiddleware } from '../../auth/index.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import type { AgentCard } from '../../types/agent-card.js';
import type { RequestContext } from '../../types/auth.js';
import { ErrorCodes, JsonRpcError, type JsonRpcRequest } from '../../types/jsonrpc.js';
import type { Task } from '../../types/task.js';
import type { IdempotencyStore } from '../IdempotencyStore.js';
import type { SSEStreamer } from '../SSEStreamer.js';
import type { TaskManager } from '../TaskManager.js';
import { signAgentCard, type SigningKey } from '../../security/AgentCardSigner.js';
import {
  createJsonRpcHttpHandler,
  type HandleRpc,
  type HandleStreamingRpc,
} from './jsonRpcHandler.js';
import { registerMetricsRoutes } from './metricsRoutes.js';
import { registerStreamRoutes, authenticateRequestOrSend401 } from './streamRoutes.js';
import * as pv from './protocolVersion.js';

export const AGENT_CARD_PATHS = [
  '/.well-known/agent-card.json',
  '/.well-known/agent.json',
] as const;
export const JSON_RPC_PATHS = ['/', '/rpc', '/a2a/jsonrpc'] as const;

type FilterTasksByContext = (tasks: Task[], context: RequestContext) => Task[];
type CanAccessTask = (task: Task, context: RequestContext) => boolean;
type RestRouteHandler = (req: Request, res: Response) => Promise<void>;

export interface A2AHttpRouteDependencies {
  app: Express;
  agentCard: AgentCard;
  signingKey: SigningKey | undefined;
  startedAt: number;
  taskManager: TaskManager;
  runtimeMetrics: RuntimeMetrics;
  authMiddleware: JwtAuthMiddleware | undefined;
  streamer: SSEStreamer;
  idempotencyStore: IdempotencyStore;
  idempotencyTtlMs: number;
  handleRpc: HandleRpc;
  handleStreamingRpc: HandleStreamingRpc;
  canAccessTask: CanAccessTask;
  filterTasksByContext: FilterTasksByContext;
}

export function registerA2ARoutes(deps: A2AHttpRouteDependencies): void {
  registerAgentCardRoutes(deps);
  registerMetricsRoutes({
    app: deps.app,
    agentCard: deps.agentCard,
    startedAt: deps.startedAt,
    runtimeMetrics: deps.runtimeMetrics,
    getTaskCounts: () => deps.taskManager.getTaskCounts(),
  });

  deps.app.get(
    '/tasks',
    restRoute((req, res) => handleTasksRoute(req, res, deps)),
  );

  const jsonRpcHandler = createJsonRpcHttpHandler({
    authMiddleware: deps.authMiddleware,
    runtimeMetrics: deps.runtimeMetrics,
    idempotencyStore: deps.idempotencyStore,
    idempotencyTtlMs: deps.idempotencyTtlMs,
    handleRpc: deps.handleRpc,
    handleStreamingRpc: deps.handleStreamingRpc,
  });
  for (const path of JSON_RPC_PATHS) {
    deps.app.post(path, jsonRpcHandler);
  }

  registerRestBindingRoutes(deps);

  registerStreamRoutes(deps.app, {
    taskManager: deps.taskManager,
    streamer: deps.streamer,
    runtimeMetrics: deps.runtimeMetrics,
    authMiddleware: deps.authMiddleware,
    canAccessTask: deps.canAccessTask,
  });
}

function registerRestBindingRoutes(deps: A2AHttpRouteDependencies): void {
  const sendHandler = async (req: Request, res: Response) => {
    await handleRestRpc(req, res, deps, 'message/send', restBody(req));
  };
  const streamHandler = async (req: Request, res: Response) => {
    await handleRestStream(req, res, deps, 'message/stream', restBody(req));
  };
  const subscribeHandler = async (req: Request, res: Response) => {
    await handleRestStream(req, res, deps, 'tasks/resubscribe', { taskId: restParam(req, 0) });
  };
  const getTaskHandler = async (req: Request, res: Response) => {
    await handleRestRpc(req, res, deps, 'tasks/get', { taskId: restParam(req, 0) });
  };
  const cancelTaskHandler = async (req: Request, res: Response) => {
    await handleRestRpc(req, res, deps, 'tasks/cancel', { taskId: restParam(req, 0) });
  };
  const setPushHandler = async (req: Request, res: Response) => {
    const body = restBody(req);
    const config = selectRestPushConfig(body);
    await handleRestRpc(req, res, deps, 'tasks/pushNotificationConfig/create', {
      taskId: restParam(req, 0),
      configId: selectRestPushConfigId(body, config),
      pushNotificationConfig: config,
    });
  };
  const getPushHandler = async (req: Request, res: Response) => {
    await handleRestRpc(req, res, deps, 'tasks/pushNotificationConfig/get', {
      taskId: restParam(req, 0),
      configId: restParam(req, 1),
    });
  };
  const listPushHandler = async (req: Request, res: Response) => {
    const task = await getAccessibleRestTask(req, res, deps);
    if (!task) return;
    res.type(pv.A2A_REST_MEDIA_TYPE).json({
      configs: deps.taskManager.listPushNotifications(task.id),
    });
  };
  const deletePushHandler = async (req: Request, res: Response) => {
    const task = await getAccessibleRestTask(req, res, deps);
    if (!task) return;
    deps.taskManager.removePushNotificationConfig(task.id, restParam(req, 1) ?? 'default');
    res.status(204).end();
  };

  deps.app.post(/^\/message:send$/, restRoute(sendHandler));
  deps.app.post(/^\/([^/]+)\/message:send$/, restRoute(sendHandler));
  deps.app.post(/^\/message:stream$/, restRoute(streamHandler));
  deps.app.post(/^\/([^/]+)\/message:stream$/, restRoute(streamHandler));
  deps.app.get(/^\/tasks\/([^/]+)$/, restRoute(getTaskHandler));
  deps.app.get(/^\/([^/]+)\/tasks\/([^/]+)$/, restRoute(tenantAware(getTaskHandler, 1)));
  deps.app.post(/^\/tasks\/([^/]+):cancel$/, restRoute(cancelTaskHandler));
  deps.app.post(/^\/([^/]+)\/tasks\/([^/]+):cancel$/, restRoute(tenantAware(cancelTaskHandler, 1)));
  deps.app.get(/^\/tasks\/([^/]+):subscribe$/, restRoute(subscribeHandler));
  deps.app.get(
    /^\/([^/]+)\/tasks\/([^/]+):subscribe$/,
    restRoute(tenantAware(subscribeHandler, 1)),
  );
  deps.app.post(/^\/tasks\/([^/]+)\/pushNotificationConfigs$/, restRoute(setPushHandler));
  deps.app.post(
    /^\/([^/]+)\/tasks\/([^/]+)\/pushNotificationConfigs$/,
    restRoute(tenantAware(setPushHandler, 1)),
  );
  deps.app.get(/^\/tasks\/([^/]+)\/pushNotificationConfigs$/, restRoute(listPushHandler));
  deps.app.get(
    /^\/([^/]+)\/tasks\/([^/]+)\/pushNotificationConfigs$/,
    restRoute(tenantAware(listPushHandler, 1)),
  );
  deps.app.get(/^\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/, restRoute(getPushHandler));
  deps.app.get(
    /^\/([^/]+)\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/,
    restRoute(tenantAware(getPushHandler, 1)),
  );
  deps.app.delete(
    /^\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/,
    restRoute(deletePushHandler),
  );
  deps.app.delete(
    /^\/([^/]+)\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/,
    restRoute(tenantAware(deletePushHandler, 1)),
  );
}

function restRoute(handler: RestRouteHandler): (req: Request, res: Response) => void {
  return (req: Request, res: Response) => {
    try {
      pv.assertSupportedA2AProtocolVersion(req);
    } catch (error: unknown) {
      writeRestError(res, error);
      return;
    }

    void handler(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      writeRestError(res, error);
    });
  };
}

function tenantAware(
  handler: (req: Request, res: Response) => Promise<void>,
  taskParamIndex: number,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    const taskId = req.params[String(taskParamIndex)];
    if (typeof taskId !== 'string') {
      writeRestError(res, new JsonRpcError(ErrorCodes.InvalidParams, 'Missing task id'));
      return;
    }
    req.params[0] = taskId;
    await handler(req, res);
  };
}

function restParam(req: Request, index: number): string | undefined {
  const value = req.params[String(index)];
  return typeof value === 'string' ? value : undefined;
}

function restBody(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

function selectRestPushConfig(body: Record<string, unknown>): unknown {
  return (
    body['config'] ?? body['pushNotificationConfig'] ?? body['taskPushNotificationConfig'] ?? body
  );
}

function selectRestPushConfigId(
  body: Record<string, unknown>,
  config: unknown,
): string | undefined {
  const rawId = body['configId'] ?? body['id'];
  if (typeof rawId === 'string' && rawId.trim().length > 0) {
    return rawId.trim();
  }
  if (config && typeof config === 'object' && 'id' in config) {
    const configId = (config as { id?: unknown }).id;
    return typeof configId === 'string' && configId.trim().length > 0 ? configId.trim() : undefined;
  }
  return undefined;
}

async function getAccessibleRestTask(
  req: Request,
  res: Response,
  deps: A2AHttpRouteDependencies,
): Promise<Task | undefined> {
  const requestContext = await authenticateRequestOrSend401(
    req,
    res,
    deps.authMiddleware,
    deps.runtimeMetrics,
  );
  if (!requestContext) return undefined;

  const taskId = restParam(req, 0);
  if (!taskId) {
    writeRestError(res, new JsonRpcError(ErrorCodes.InvalidParams, 'Missing task id'));
    return undefined;
  }

  const task = deps.taskManager.getTask(taskId);
  if (!task) {
    writeRestError(res, new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found'));
    return undefined;
  }

  if (!deps.canAccessTask(task, requestContext)) {
    writeRestError(res, new JsonRpcError(ErrorCodes.Unauthorized, 'Forbidden'));
    return undefined;
  }

  return task;
}

async function handleRestRpc(
  req: Request,
  res: Response,
  deps: A2AHttpRouteDependencies,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  const requestContext = await authenticateRequestOrSend401(
    req,
    res,
    deps.authMiddleware,
    deps.runtimeMetrics,
  );
  if (!requestContext) return;

  try {
    const rpcReq: JsonRpcRequest = { jsonrpc: '2.0', id: null, method, params };
    const result = await deps.handleRpc(rpcReq, { req, requestContext });
    res.type(pv.A2A_REST_MEDIA_TYPE).json(result);
  } catch (error) {
    writeRestError(res, error);
  }
}

async function handleRestStream(
  req: Request,
  res: Response,
  deps: A2AHttpRouteDependencies,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  const requestContext = await authenticateRequestOrSend401(
    req,
    res,
    deps.authMiddleware,
    deps.runtimeMetrics,
  );
  if (!requestContext) return;

  try {
    const rpcReq: JsonRpcRequest = { jsonrpc: '2.0', id: null, method, params };
    await deps.handleStreamingRpc(rpcReq, { req, requestContext }, res);
  } catch (error) {
    writeRestError(res, error);
  }
}

function writeRestError(res: Response, error: unknown): void {
  if (error instanceof JsonRpcError) {
    if (error.code === ErrorCodes.VersionNotSupported) {
      res
        .status(400)
        .type('application/problem+json')
        .json({
          type: pv.A2A_VERSION_NOT_SUPPORTED_PROBLEM_TYPE,
          title: 'Protocol Version Not Supported',
          status: 400,
          detail: error.message,
          supportedVersions: [...pv.SUPPORTED_A2A_PROTOCOL_VERSIONS],
        });
      return;
    }

    const status = restStatusForError(error.code);
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: restProblemDetailsForError(error.code).type,
        title: restProblemDetailsForError(error.code).title,
        status,
        detail: error.message,
        code: error.code,
        ...(error.data !== undefined ? { data: error.data } : {}),
      });
    return;
  }
  res
    .status(500)
    .type('application/problem+json')
    .json({
      type: restProblemDetailsForError(ErrorCodes.InternalError).type,
      title: restProblemDetailsForError(ErrorCodes.InternalError).title,
      status: 500,
      detail: 'Internal Error',
      code: ErrorCodes.InternalError,
    });
}

interface RestProblemDetails {
  readonly type: string;
  readonly title: string;
}

const INTERNAL_ERROR_PROBLEM: RestProblemDetails = {
  type: 'https://a2a-protocol.org/errors/internal-error',
  title: 'Internal Error',
};

const REST_PROBLEM_DETAILS_BY_CODE = new Map<number, RestProblemDetails>([
  [
    ErrorCodes.InvalidParams,
    { type: 'https://a2a-protocol.org/errors/invalid-params', title: 'Invalid Parameters' },
  ],
  [
    ErrorCodes.InvalidRequest,
    { type: 'https://a2a-protocol.org/errors/invalid-request', title: 'Invalid Request' },
  ],
  [
    ErrorCodes.TaskNotFound,
    { type: 'https://a2a-protocol.org/errors/task-not-found', title: 'Task Not Found' },
  ],
  [
    ErrorCodes.Unauthorized,
    { type: 'https://a2a-protocol.org/errors/forbidden', title: 'Forbidden' },
  ],
  [
    ErrorCodes.UnsupportedOperation,
    {
      type: 'https://a2a-protocol.org/errors/unsupported-operation',
      title: 'Unsupported Operation',
    },
  ],
  [
    ErrorCodes.InvalidTaskTransition,
    {
      type: 'https://a2a-protocol.org/errors/invalid-task-transition',
      title: 'Invalid Task Transition',
    },
  ],
]);

function restProblemDetailsForError(code: number): RestProblemDetails {
  return REST_PROBLEM_DETAILS_BY_CODE.get(code) ?? INTERNAL_ERROR_PROBLEM;
}

function restStatusForError(code: number): number {
  switch (code) {
    case ErrorCodes.InvalidParams:
    case ErrorCodes.InvalidRequest:
    case ErrorCodes.VersionNotSupported:
      return 400;
    case ErrorCodes.TaskNotFound:
      return 404;
    case ErrorCodes.Unauthorized:
      return 403;
    case ErrorCodes.UnsupportedOperation:
      return 501;
    default:
      return 500;
  }
}

function registerAgentCardRoutes(
  deps: Pick<A2AHttpRouteDependencies, 'app' | 'agentCard' | 'signingKey'>,
): void {
  const serveCard = async (_req: Request, res: Response) => {
    const card = deps.signingKey
      ? await signAgentCard(deps.agentCard, deps.signingKey)
      : deps.agentCard;
    res.json(card);
  };

  for (const path of AGENT_CARD_PATHS) {
    deps.app.get(path, serveCard);
  }
}

async function handleTasksRoute(
  req: Request,
  res: Response,
  deps: Pick<
    A2AHttpRouteDependencies,
    'authMiddleware' | 'runtimeMetrics' | 'taskManager' | 'filterTasksByContext'
  >,
): Promise<void> {
  const requestContext = await authenticateRequestOrSend401(
    req,
    res,
    deps.authMiddleware,
    deps.runtimeMetrics,
  );
  if (!requestContext) {
    return;
  }

  const tasks = deps.filterTasksByContext(deps.taskManager.getAllTasks(), requestContext);
  tasks.sort(
    (a, b) => new Date(b.status.timestamp).getTime() - new Date(a.status.timestamp).getTime(),
  );

  const limit = parsePaginationNumber(req.query['limit'], 20);
  const offset = parsePaginationNumber(req.query['offset'], 0);
  const page = tasks.slice(offset, offset + limit);
  res
    .type(pv.A2A_REST_MEDIA_TYPE)
    .setHeader('X-A2A-Page-Limit', String(limit))
    .setHeader('X-A2A-Page-Offset', String(offset))
    .setHeader('X-A2A-Page-Total', String(tasks.length));
  if (offset + limit < tasks.length) {
    res.setHeader('X-A2A-Page-Next-Offset', String(offset + limit));
  }
  res.json(page);
}

function parsePaginationNumber(value: unknown, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
