import type { Express } from 'express';
import type { RequestContext } from '@a2amesh/runtime';
import type { RegistryAuthController } from './auth.js';
import type { RegistryMetricsController } from './metrics.js';
import {
  type RegistryOperatorContext,
  type RegistryServerContext,
  type RegistryVisibilityScope,
} from './types.js';

export function registerRegistryOperatorRoutes(
  app: Express,
  context: RegistryServerContext,
  auth: RegistryAuthController,
  metrics: RegistryMetricsController,
): void {
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
