/**
 * @file A2AServer.ts
 * Express adapter facade for agent card discovery, JSON-RPC, and streaming routes.
 */

import type { Server as HttpServer } from 'node:http';
import express, { type Express, type Response } from 'express';
import type { JwtAuthMiddlewareOptions } from '../auth/index.js';
import { JwtAuthMiddleware } from '../auth/index.js';
import type { RateLimitConfig, RateLimitStore } from '../middleware/rateLimiter.js';
import { createRateLimiter, InMemoryRateLimitStore } from '../middleware/rateLimiter.js';
import type { OutboundPolicyOptions } from '../net/OutboundPolicy.js';
import { InMemoryTaskStorage } from '../storage/InMemoryTaskStorage.js';
import type { ITaskStorage } from '../storage/ITaskStorage.js';
import { RuntimeMetrics, a2aMeshTracer, SpanStatusCode } from '../telemetry/index.js';
import type { AgentCard, AnyAgentCard } from '../types/agent-card.js';
import type { RequestContext } from '@a2amesh/protocol';
import type { JsonRpcRequest } from '../types/jsonrpc.js';
import type {
  Artifact,
  ExtensibleArtifact,
  Message,
  PushNotificationConfig,
  Task,
} from '../types/task.js';
import { logger } from '../utils/logger.js';
import { InMemoryIdempotencyStore, type IdempotencyStore } from './IdempotencyStore.js';
import { PushNotificationService } from './PushNotificationService.js';
import { SSEStreamer } from './SSEStreamer.js';
import { TaskLifecycleError, TaskManager } from './TaskManager.js';
import type { SigningKey, VerificationKey } from '../security/AgentCardSigner.js';
import {
  canAccessTask,
  filterTasksByContext,
  handleMessageRequest,
  handleRpcRequest,
  normalizeArtifacts,
  type MessageRequestDependencies,
  type RpcContext,
} from './http/jsonRpcHandler.js';
import {
  createOriginGuardMiddleware,
  createRequestContextMiddleware,
  createTelemetryContextMiddleware,
  jsonParseErrorHandler,
} from './http/middleware.js';
import { bindTaskObservers, normalizePushNotificationConfig } from './http/pushCallbacks.js';
import { registerA2ARoutes } from './http/routes.js';
import { handleStreamingRpc as handleStreamingRpcRequest } from './http/streamRoutes.js';

export interface A2AServerOptions {
  rateLimit?: Partial<RateLimitConfig>;
  rateLimitStore?: RateLimitStore;
  auth?: JwtAuthMiddlewareOptions;
  taskStorage?: ITaskStorage;
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
  allowUnresolvedHostnames?: boolean;
  outboundPolicy?: OutboundPolicyOptions;
  allowedOrigins?: string[];
  requireOrigin?: boolean;
  bodyLimit?: string;
  idempotencyStore?: IdempotencyStore;
  idempotencyTtlMs?: number;
  idempotencyLeaseMs?: number;
  signingKey?: SigningKey;
  trustedVerificationKeys?: VerificationKey[];
  taskTtlMs?: number;
}

export abstract class A2AServer {
  protected app: Express;
  protected agentCard: AgentCard;
  protected taskManager: TaskManager;
  protected streamer: SSEStreamer;
  protected pushNotificationService: PushNotificationService;
  protected authMiddleware: JwtAuthMiddleware | undefined;
  private httpServer: HttpServer | undefined;
  private readonly startedAt = Date.now();
  private readonly runtimeMetrics: RuntimeMetrics;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly rateLimitStore: RateLimitStore;

  constructor(
    agentCard: AgentCard,
    private readonly options: A2AServerOptions = {},
  ) {
    this.app = express();
    this.agentCard = agentCard;
    this.taskManager = new TaskManager(options.taskStorage ?? new InMemoryTaskStorage());
    this.streamer = new SSEStreamer();
    this.pushNotificationService = new PushNotificationService({
      outboundPolicy: this.createOutboundPolicyOptions(),
    });
    this.authMiddleware = options.auth ? new JwtAuthMiddleware(options.auth) : undefined;
    this.runtimeMetrics = new RuntimeMetrics({
      serviceName: agentCard.name,
      serviceVersion: agentCard.version,
    });
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();

    this.setupMiddleware();
    this.setupRoutes();
    this.bindTaskObservers();
  }

  private setupMiddleware(): void {
    this.app.use(createRequestContextMiddleware());
    this.app.use(createTelemetryContextMiddleware());
    this.app.use(
      createOriginGuardMiddleware({
        allowedOrigins: this.options.allowedOrigins,
        requireOrigin: this.options.requireOrigin,
      }),
    );
    this.app.use(createRateLimiter(this.options.rateLimit ?? {}, this.rateLimitStore));
    this.app.use(
      express.json({
        limit: this.options.bodyLimit ?? '1mb',
        type: ['application/json', 'application/*+json'],
      }),
    );
    this.app.use(jsonParseErrorHandler());
  }

  private setupRoutes(): void {
    registerA2ARoutes({
      app: this.app,
      agentCard: this.agentCard,
      signingKey: this.options.signingKey,
      startedAt: this.startedAt,
      taskManager: this.taskManager,
      runtimeMetrics: this.runtimeMetrics,
      authMiddleware: this.authMiddleware,
      streamer: this.streamer,
      idempotencyStore: this.idempotencyStore,
      idempotencyTtlMs: this.options.idempotencyTtlMs ?? 60 * 60 * 1000,
      idempotencyLeaseMs: this.options.idempotencyLeaseMs ?? 30_000,
      handleRpc: (rpcReq, context) => this.handleRpc(rpcReq, context),
      handleStreamingRpc: (rpcReq, context, res, idempotency, responseDialect) =>
        this.handleStreamingRpc(rpcReq, context, res, idempotency, responseDialect),
      canAccessTask: (task, context) => this.canAccessTask(task, context),
      filterTasksByContext: (tasks, context) => this.filterTasksByContext(tasks, context),
    });
  }

  private bindTaskObservers(): void {
    bindTaskObservers({
      taskManager: this.taskManager,
      streamer: this.streamer,
      pushNotificationService: this.pushNotificationService,
      runtimeMetrics: this.runtimeMetrics,
    });
  }

  protected async handleRpc(req: JsonRpcRequest, context: RpcContext): Promise<unknown> {
    return handleRpcRequest(req, context, {
      ...this.createMessageRequestDependencies(),
      runtimeMetrics: this.runtimeMetrics,
    });
  }

  protected normalizeArtifacts(task: Task, artifacts: Artifact[]): ExtensibleArtifact[] {
    return normalizeArtifacts(task, artifacts);
  }

  public getExpressApp(): Express {
    return this.app;
  }

  public getAgentCard(): AgentCard {
    return this.agentCard;
  }

  public getTaskManager(): TaskManager {
    return this.taskManager;
  }

  public static fromCard(card: AnyAgentCard): AgentCard {
    return card.protocolVersion === '1.0'
      ? card
      : ({ ...card, protocolVersion: '1.0' } as AgentCard);
  }

  protected async processTaskInternal(
    task: Task,
    message: Message,
    signal?: AbortSignal,
  ): Promise<void> {
    const span = a2aMeshTracer.startSpan('a2a.processTask', {
      attributes: {
        'a2a.task_id': task.id,
        'a2a.context_id': task.contextId ?? '',
      },
    });
    try {
      const artifacts = await this.handleTask(task, message, signal);
      this.normalizeArtifacts(task, artifacts).forEach((artifact) => {
        this.taskManager.addArtifact(task.id, artifact);
      });
      this.taskManager.updateTaskState(task.id, 'COMPLETED');
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error: unknown) {
      try {
        this.taskManager.updateTaskState(task.id, 'FAILED');
      } catch (lifecycleError) {
        if (
          lifecycleError instanceof TaskLifecycleError &&
          lifecycleError.code === 'TASK_TERMINAL'
        ) {
          span.setStatus({ code: SpanStatusCode.OK, message: 'Task already terminal' });
          return;
        }
        throw lifecycleError;
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Adapter implementation entry point. Must be implemented by specific adapters.
   */
  abstract handleTask(task: Task, message: Message, signal?: AbortSignal): Promise<Artifact[]>;

  public start(port: number): HttpServer {
    this.httpServer = this.app.listen(port, () => {
      logger.info(`A2A Server listening on port ${port}`);
    });
    return this.httpServer;
  }

  public async stop(): Promise<void> {
    this.streamer.stop();
    this.taskManager.removeAllListeners();
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('Server is not running')) {
          throw error;
        }
      });
      this.httpServer = undefined;
    }
    this.rateLimitStore.destroy?.();
    const storage = this.options.taskStorage as
      | { close?: () => void; clear?: () => void }
      | undefined;
    storage?.close?.();
  }

  private createMessageRequestDependencies(): MessageRequestDependencies {
    return {
      agentCard: this.agentCard,
      taskManager: this.taskManager,
      authMiddleware: this.authMiddleware,
      normalizePushNotificationConfig: (config) => this.normalizePushNotificationConfig(config),
      processTask: (task, message, signal) => this.processTaskInternal(task, message, signal),
    };
  }

  private async normalizePushNotificationConfig(
    config: PushNotificationConfig,
  ): Promise<PushNotificationConfig> {
    return normalizePushNotificationConfig(config, this.createOutboundPolicyOptions());
  }

  private createOutboundPolicyOptions(): OutboundPolicyOptions {
    const policy = this.options.outboundPolicy ?? {};
    return {
      ...policy,
      allowLocalhost:
        policy.allowLocalhost ??
        this.options.allowLocalhost ??
        process.env['NODE_ENV'] !== 'production',
      allowPrivateNetworks:
        policy.allowPrivateNetworks ?? this.options.allowPrivateNetworks ?? false,
      allowUnresolvedHostnames:
        policy.allowUnresolvedHostnames ?? this.options.allowUnresolvedHostnames ?? false,
    };
  }

  private filterTasksByContext(tasks: Task[], context: RequestContext): Task[] {
    return filterTasksByContext(tasks, context, this.authMiddleware);
  }

  private canAccessTask(task: Task, context: RequestContext): boolean {
    return canAccessTask(task, context, this.authMiddleware);
  }

  private async handleStreamingRpc(
    rpcReq: JsonRpcRequest,
    context: RpcContext,
    res: Response,
    idempotency?: Parameters<typeof handleStreamingRpcRequest>[3],
    responseDialect?: Parameters<typeof handleStreamingRpcRequest>[5],
  ): Promise<void> {
    return handleStreamingRpcRequest(
      rpcReq,
      context,
      res,
      idempotency,
      {
        taskManager: this.taskManager,
        runtimeMetrics: this.runtimeMetrics,
        idempotencyStore: this.idempotencyStore,
        idempotencyTtlMs: this.options.idempotencyTtlMs ?? 60 * 60 * 1000,
        canAccessTask: (task, requestContext) => this.canAccessTask(task, requestContext),
        handleMessageRequest: (params, method, req, signal) =>
          handleMessageRequest(
            params,
            method,
            req,
            signal,
            this.createMessageRequestDependencies(),
          ),
      },
      responseDialect,
    );
  }
}
