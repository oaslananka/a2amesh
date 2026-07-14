/**
 * @file FleetControlPlaneServer.ts
 * Express facade for the authenticated and tenant-scoped Fleet control plane.
 */

import type { Server as HttpServer } from 'node:http';
import cors from 'cors';
import express, { type Express, type RequestHandler } from 'express';
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
import { createDevelopmentPrincipalMiddleware } from './server/authorization.js';
import { registerFleetRoutes } from './server/routes.js';
import { createFleetSse } from './server/sse.js';
import type { FleetServerContext } from './server/types.js';
import type { IFleetStorage } from './storage/IFleetStorage.js';
import { InMemoryFleetStorage } from './storage/InMemoryFleetStorage.js';

export type FleetServerMode = 'development' | 'production';

export interface FleetServerSecurityOptions {
  /** Defaults to `production` when NODE_ENV=production, otherwise `development`. */
  mode?: FleetServerMode;
  /** Exact browser origins allowed to call the API. Wildcards are not accepted. */
  allowedOrigins?: readonly string[];
  /** Defaults to false. When false, requesters cannot approve their own high-risk runs. */
  allowHighRiskSelfApproval?: boolean;
}

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
  security?: FleetServerSecurityOptions;
  /** Network interface used by `start`. Defaults to loopback (`127.0.0.1`). */
  host?: string;
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
  private readonly host: string;
  private readonly authConfigured: boolean;
  private httpServer: HttpServer | undefined;

  constructor(options: FleetControlPlaneServerOptions) {
    this.app = express();
    this.rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();
    this.host = options.host ?? '127.0.0.1';
    this.authConfigured = options.auth !== undefined;

    const mode =
      options.security?.mode ??
      (process.env['NODE_ENV'] === 'production' ? 'production' : 'development');
    const allowedOrigins = normalizeAllowedOrigins(options.security?.allowedOrigins ?? []);
    validateSecurityConfiguration({
      mode,
      host: this.host,
      authConfigured: this.authConfigured,
      allowedOrigins,
    });

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
      allowHighRiskSelfApproval: options.security?.allowHighRiskSelfApproval ?? false,
    };

    this.app.use(createCorsOriginGuard(allowedOrigins));
    if (allowedOrigins.length > 0) {
      this.app.use(
        cors({
          origin: allowedOrigins,
          methods: ['GET', 'POST', 'OPTIONS'],
          credentials: true,
          maxAge: 600,
        }),
      );
    }
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
    } else {
      this.app.use('/fleet', createDevelopmentPrincipalMiddleware());
    }

    registerFleetRoutes(this.app, this.context);
  }

  public getExpressApp(): Express {
    return this.app;
  }

  public start(port: number, host: string = this.host): HttpServer {
    if (!this.authConfigured && !isLoopbackHost(host)) {
      throw new Error('Fleet control plane authentication is required for non-loopback binding');
    }
    this.httpServer = this.app.listen(port, host, () => {
      logger.info('Fleet Control Plane Server listening', { port, host });
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

function normalizeAllowedOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins.map((origin) => origin.trim()).filter(Boolean))];
}

function validateSecurityConfiguration(input: {
  mode: FleetServerMode;
  host: string;
  authConfigured: boolean;
  allowedOrigins: readonly string[];
}): void {
  if (input.mode === 'production' && !input.authConfigured) {
    throw new Error('Fleet control plane production mode requires authentication');
  }
  if (!input.authConfigured && !isLoopbackHost(input.host)) {
    throw new Error('Fleet control plane authentication is required for non-loopback binding');
  }
  if (input.allowedOrigins.includes('*')) {
    throw new Error(
      'Fleet control plane CORS requires explicit origins; wildcard origins are forbidden',
    );
  }
}

function createCorsOriginGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next): void => {
    const origin = req.header('origin');
    if (origin && !allowed.has(origin)) {
      res.status(403).json({ error: { message: 'Origin is not allowed' } });
      return;
    }
    next();
  };
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
