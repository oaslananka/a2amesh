/**
 * @file FleetControlPlaneServer.ts
 * Express facade for the Fleet control plane: exposes live worker health
 * (via `RegistryWorkerDirectory`), task routing, an operator approval queue
 * for gated side effects, artifact review, and an audit timeline — the
 * server-side surface Mission Control needs (see
 * `docs/fleet/provider-workers-mission-control.md`).
 */

import type { Server as HttpServer } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import {
  RegistryWorkerDirectory,
  type FleetRoutingPolicy,
  type FleetWorkerDirectory,
  type RegistryDiscoverySource,
} from '@a2amesh/internal-fleet';
import {
  AgentRegistryClient,
  createRateLimiter,
  InMemoryRateLimitStore,
  JwtAuthMiddleware,
  logger,
  type JwtAuthMiddlewareOptions,
  type RateLimitConfig,
  type RateLimitStore,
} from '@a2amesh/runtime';
import { InMemoryFleetStorage } from './storage/InMemoryFleetStorage.js';
import type { IFleetStorage } from './storage/IFleetStorage.js';
import { registerFleetRoutes } from './server/routes.js';
import { createFleetSse } from './server/sse.js';
import type { FleetServerContext } from './server/types.js';

export interface FleetControlPlaneServerOptions {
  /** Base URL of the `@a2amesh/registry` instance backing worker discovery. Ignored when `directory` is provided. */
  registryUrl?: string;
  /** Overrides worker discovery entirely (e.g. a `StaticWorkerDirectory` in tests). Takes precedence over `registryUrl`. */
  directory?: FleetWorkerDirectory;
  storage?: IFleetStorage;
  routingPolicy?: FleetRoutingPolicy;
  refreshIntervalMs?: number;
  staleAfterMs?: number;
  auth?: JwtAuthMiddlewareOptions;
  rateLimit?: Partial<RateLimitConfig>;
  rateLimitStore?: RateLimitStore;
  bodyLimit?: string;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
}

const DEFAULT_ROUTING_POLICY: FleetRoutingPolicy = {
  strategy: { type: 'CAPABILITY_MATCH' },
  requiredSignals: ['capability', 'availability'],
};

export class FleetControlPlaneServer {
  private readonly app: Express;
  private readonly context: FleetServerContext;
  private readonly rateLimitStore: RateLimitStore;
  private httpServer: HttpServer | undefined;

  constructor(options: FleetControlPlaneServerOptions) {
    this.app = express();
    this.rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();

    const directory: FleetWorkerDirectory =
      options.directory ??
      new RegistryWorkerDirectory(
        new AgentRegistryClient(
          requireRegistryUrl(options),
          options.fetchImplementation,
        ) satisfies RegistryDiscoverySource,
        {
          ...(options.refreshIntervalMs !== undefined
            ? { refreshIntervalMs: options.refreshIntervalMs }
            : {}),
          ...(options.staleAfterMs !== undefined ? { staleAfterMs: options.staleAfterMs } : {}),
          ...(options.now ? { now: options.now } : {}),
          activeRunCounts: () => this.context.activeRunCounts,
        },
      );

    this.context = {
      storage: options.storage ?? new InMemoryFleetStorage(),
      directory,
      routingPolicy: options.routingPolicy ?? DEFAULT_ROUTING_POLICY,
      sse: createFleetSse(),
      activeRunCounts: new Map(),
      now: options.now ?? (() => new Date()),
    };

    this.app.use(cors());
    this.app.use(createRateLimiter(options.rateLimit ?? {}, this.rateLimitStore));
    this.app.use(
      express.json({
        limit: options.bodyLimit ?? '1mb',
        type: ['application/json', 'application/*+json'],
      }),
    );

    if (options.auth) {
      const authMiddleware = new JwtAuthMiddleware(options.auth);
      this.app.use('/fleet', authMiddleware.middleware());
    }

    registerFleetRoutes(this.app, this.context);
  }

  public getExpressApp(): Express {
    return this.app;
  }

  public start(port: number): HttpServer {
    this.httpServer = this.app.listen(port, () => {
      logger.info('Fleet Control Plane Server listening', { port });
    });
    return this.httpServer;
  }

  public async stop(): Promise<void> {
    this.context.sse.closeAllClients();
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
  }
}

function requireRegistryUrl(options: FleetControlPlaneServerOptions): string {
  if (!options.registryUrl) {
    throw new Error('FleetControlPlaneServerOptions requires either "registryUrl" or "directory"');
  }
  return options.registryUrl;
}
