/**
 * @file RegistryServer.ts
 * REST API facade for registering and discovering A2A agents.
 */

import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import express, { type Express } from 'express';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  createRateLimiter,
  InMemoryRateLimitStore,
  JwtAuthMiddleware,
  logger,
} from '@a2amesh/runtime';
import { createRegistryAuth } from './server/auth.js';
import { createRegistryMetrics } from './server/metrics.js';
import { createRegistryCorsMiddleware, isOriginAllowed } from './server/origin.js';
import { createRegistryPolling, type RegistryPollingController } from './server/polling.js';
import { writeRegistryProblem } from './server/problems.js';
import { registerRegistryRoutes } from './server/routes.js';
import { createRegistrySse, type RegistrySseController } from './server/sse.js';
import { createRegistryTaskProjection } from './server/taskProjection.js';
import {
  createRegistryServerState,
  type RegistryServerContext,
  type RegistryServerOptions,
} from './server/types.js';
import { InMemoryStorage } from './storage/InMemoryStorage.js';
import type { RegisteredAgent } from './storage/IAgentStorage.js';
import { InMemoryTrustLogStorage } from './storage/InMemoryTrustLogStorage.js';

export type {
  RegistryMetricsSummary,
  RegistryServerOptions,
  RegistryTaskEvent,
} from './server/types.js';

/**
 * Registry service for agent registration, discovery, health, metrics, and live updates.
 *
 * @since 1.0.0
 */
export class RegistryServer {
  private readonly app: Express;
  private readonly context: RegistryServerContext;
  private readonly polling: RegistryPollingController;
  private readonly sse: RegistrySseController;
  private httpServer: HttpServer | undefined;

  constructor(options: RegistryServerOptions = {}) {
    this.app = express();
    this.context = {
      store: options.storage ?? new InMemoryStorage(),
      trustLog: options.trustLogStorage ?? new InMemoryTrustLogStorage(),
      events: new EventEmitter(),
      taskEvents: new EventEmitter(),
      options,
      authMiddleware: options.auth ? new JwtAuthMiddleware(options.auth) : undefined,
      rateLimitStore: options.rateLimitStore ?? new InMemoryRateLimitStore(),
      recentTasks: new Map(),
      taskVersions: new Map(),
      nextHealthCheckAt: new Map(),
      nextTaskPollAt: new Map(),
      sseClients: new Set(),
      state: createRegistryServerState(),
    };

    const auth = createRegistryAuth(this.context);
    const metrics = createRegistryMetrics(this.context);
    const taskProjection = createRegistryTaskProjection(this.context);
    this.sse = createRegistrySse(this.context);
    this.polling = createRegistryPolling(this.context, taskProjection);

    this.app.use(createRegistryCorsMiddleware(options));
    this.app.use((req, res, next) => {
      attachRequestContext(req, createAnonymousRequestContext(req));
      if (!isOriginAllowed(options, req)) {
        writeRegistryProblem(res, 'forbidden', { detail: 'Forbidden origin' });
        return;
      }
      next();
    });
    this.app.use(createRateLimiter(options.rateLimit ?? {}, this.context.rateLimitStore));
    this.app.use(
      express.json({
        limit: options.bodyLimit ?? '1mb',
        type: ['application/json', 'application/*+json'],
      }),
    );

    registerRegistryRoutes(this.app, this.context, {
      auth,
      metrics,
      polling: this.polling,
      sse: this.sse,
      taskProjection,
    });
  }

  public getExpressApp(): Express {
    return this.app;
  }

  public start(port: number) {
    this.polling.startHealthChecks();
    this.polling.startTaskPolling();
    void this.polling.refreshTaskSnapshots();
    this.httpServer = this.app.listen(port, () => {
      logger.info('Registry Server listening', { port });
    });
    return this.httpServer;
  }

  public async stop(): Promise<void> {
    this.polling.stop();
    this.sse.closeAllClients();
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
    this.context.rateLimitStore.destroy?.();
  }

  private async executeHealthChecks(agents: RegisteredAgent[]): Promise<void> {
    await this.polling.executeHealthChecks(agents);
  }

  private async refreshTaskSnapshots(): Promise<void> {
    await this.polling.refreshTaskSnapshots();
  }
}
