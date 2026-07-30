import type { Express, Request, Response } from 'express';
import type { RequestContext } from '@a2amesh/runtime';
import type { RegistryAuthController } from './auth.js';
import { registerAgentDiscoveryRoutes } from './agentDiscoveryRoutes.js';
import { registerAgentRegistrationRoutes } from './agentRegistrationRoutes.js';
import { registerAgentLifecycleRoutes } from './agentLifecycleRoutes.js';
import { registerRegistryImportExportRoutes } from './registryImportExportRoutes.js';
import type { RegistryMetricsController } from './metrics.js';
import type { RegistryPollingController } from './polling.js';
import type { RegistrySseController } from './sse.js';
import type { RegistryTaskProjectionController } from './taskProjection.js';
import {
  type RegistryOperatorContext,
  type RegistryServerContext,
  type RegistryVisibilityScope,
} from './types.js';

export interface RegistryRouteControllers {
  auth: RegistryAuthController;
  metrics: RegistryMetricsController;
  polling: Pick<RegistryPollingController, 'refreshTaskSnapshots'>;
  sse: RegistrySseController;
  taskProjection: RegistryTaskProjectionController;
}

export function registerRegistryRoutes(
  app: Express,
  context: RegistryServerContext,
  controllers: RegistryRouteControllers,
): void {
  const { auth, metrics, polling, sse, taskProjection } = controllers;

  app.get('/health', async (_req, res) => {
    const agents = await context.store.summarize();
    res.json({
      status: 'ok',
      agents: agents.agentCount,
      healthyAgents: agents.healthyAgents,
    });
  });

  app.get('/metrics', async (_req, res) => {
    const summary = await metrics.getSummary();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.renderPrometheusText(summary));
  });

  app.get('/metrics/summary', async (_req, res) => {
    res.json(await metrics.getSummary());
  });

  app.get('/context', async (req, res) => {
    const healthStaleAfterMs = resolveHealthStaleAfterMs(context);
    if (req.query['public'] === 'true') {
      const publicContext: RegistryOperatorContext = {
        accessMode: 'readonly-public',
        authMethod: 'anonymous',
        tenantId: null,
        visibilityScope: 'public-only',
        healthStaleAfterMs,
      };
      res.json(publicContext);
      return;
    }

    const requestContext = await auth.authenticateControlPlane(req, res);
    if (!requestContext) {
      return;
    }

    const operatorContext: RegistryOperatorContext = {
      accessMode: 'authenticated',
      authMethod: requestContext.authMethod,
      tenantId: requestContext.tenantId ?? null,
      visibilityScope: resolveVisibilityScope(requestContext, auth),
      healthStaleAfterMs,
    };
    res.json(operatorContext);
  });

  app.get('/events', async (req: Request, res: Response) => {
    await handleSseStream(req, res, auth, sse, context.events, 'registry_update', (payload) => {
      sse.writeData(res, payload, 'registry_update');
    });
  });

  app.get('/agents/stream', async (req: Request, res: Response) => {
    await handleSseStream(req, res, auth, sse, context.events, 'registry_update', (payload) => {
      const normalized = sse.normalizeAgentStreamPayload(payload);
      if (normalized) {
        sse.writeData(res, normalized);
      }
    });
  });

  registerAgentRegistrationRoutes(app, context, auth);

  registerAgentDiscoveryRoutes(app, context, auth);

  registerRegistryImportExportRoutes(app, context, auth);

  registerAgentLifecycleRoutes(app, context, auth, taskProjection);

  app.get('/tasks/recent', async (req, res) => {
    if (await auth.rejectUnauthenticatedControlPlane(req, res)) {
      return;
    }
    if (context.recentTasks.size === 0) {
      await polling.refreshTaskSnapshots();
    }

    const limitParam = Number(req.query['limit']);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? limitParam
        : (context.options.maxRecentTasks ?? 50);

    res.json(taskProjection.getRecentTasks(limit));
  });

  app.get('/tasks/stream', async (req, res) => {
    await handleSseStream(
      req,
      res,
      auth,
      sse,
      context.taskEvents,
      'task_updated',
      (payload) => {
        sse.writeData(res, payload);
      },
      () => {
        for (const taskEvent of taskProjection.getRecentTasks(10)) {
          sse.writeData(res, taskEvent);
        }
      },
    );
  });
}

function resolveVisibilityScope(
  requestContext: RequestContext,
  auth: RegistryAuthController,
): RegistryVisibilityScope {
  if (!auth.shouldEnforceTenantIsolation(requestContext)) {
    return 'all';
  }
  return requestContext.tenantId ? 'tenant-and-public' : 'public-and-unassigned';
}

function resolveHealthStaleAfterMs(context: RegistryServerContext): number {
  const longestRecheckIntervalMs = Math.max(
    context.options.healthyRecheckIntervalMs ?? 30_000,
    context.options.unhealthyRecheckIntervalMs ?? 60_000,
    context.options.unknownRecheckIntervalMs ?? 120_000,
  );
  return longestRecheckIntervalMs * 2;
}

function setupSseListener(
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitter: any,
  event: string,
  listener: (payload: unknown) => void,
) {
  emitter.on(event, listener);
  res.on('close', () => {
    emitter.off(event, listener);
  });
}

async function handleSseStream(
  req: Request,
  res: Response,
  auth: RegistryAuthController,
  sse: RegistrySseController,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitter: any,
  event: string,
  listener: (payload: unknown) => void,
  onConfigure?: () => void,
) {
  if (await auth.rejectUnauthenticatedControlPlane(req, res)) {
    return;
  }
  sse.configure(res);
  if (onConfigure) {
    onConfigure();
  }
  setupSseListener(res, emitter, event, listener);
}
