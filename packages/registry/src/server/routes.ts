import type { Express } from 'express';
import type { RegistryAuthController } from './auth.js';
import { registerAgentDiscoveryRoutes } from './agentDiscoveryRoutes.js';
import { registerAgentRegistrationRoutes } from './agentRegistrationRoutes.js';
import { registerAgentLifecycleRoutes } from './agentLifecycleRoutes.js';
import { registerRegistryImportExportRoutes } from './registryImportExportRoutes.js';
import { registerRegistryOperatorRoutes } from './registryOperatorRoutes.js';
import { registerRegistryTaskStreamRoutes } from './registryTaskStreamRoutes.js';
import type { RegistryMetricsController } from './metrics.js';
import type { RegistryPollingController } from './polling.js';
import type { RegistrySseController } from './sse.js';
import type { RegistryTaskProjectionController } from './taskProjection.js';
import type { RegistryServerContext } from './types.js';

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

  registerRegistryOperatorRoutes(app, context, auth, metrics);

  registerAgentRegistrationRoutes(app, context, auth);

  registerAgentDiscoveryRoutes(app, context, auth);

  registerRegistryImportExportRoutes(app, context, auth);

  registerAgentLifecycleRoutes(app, context, auth, taskProjection);

  registerRegistryTaskStreamRoutes(app, context, auth, polling, sse, taskProjection);
}
