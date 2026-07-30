import type { Express, Request, Response } from 'express';
import { logger, type RequestContext } from '@a2amesh/runtime';
import type { RegisteredAgent } from '../storage/IAgentStorage.js';
import { routeParam } from './agentDiscoveryRoutes.js';
import type { RegistryAuthController } from './auth.js';
import { writeRegistryProblem } from './problems.js';
import type { RegistryTaskProjectionController } from './taskProjection.js';
import type { RegistryServerContext } from './types.js';

export function registerAgentLifecycleRoutes(
  app: Express,
  context: RegistryServerContext,
  auth: RegistryAuthController,
  taskProjection: Pick<RegistryTaskProjectionController, 'purgeAgentTaskState'>,
): void {
  const heartbeatAgent = async (req: Request, res: Response): Promise<void> => {
    await handleAuthorizedAgentRequest(req, res, context, auth, async (agent) => {
      const updated: RegisteredAgent = {
        ...agent,
        status: 'healthy',
        lastHeartbeatAt: new Date().toISOString(),
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
      };
      await context.store.upsert(updated);
      context.nextHealthCheckAt.set(
        updated.id,
        Date.now() + (context.options.healthyRecheckIntervalMs ?? 30_000),
      );
      context.state.metrics.heartbeats += 1;
      emitRegistryEvent(context, { type: 'heartbeat', agent: updated });
      res.json(updated);
    });
  };
  app.post('/agents/:id/heartbeat', heartbeatAgent);
  app.post('/admin/agents/:id/heartbeat', heartbeatAgent);

  const deleteAgent = async (req: Request, res: Response): Promise<void> => {
    await handleAuthorizedAgentRequest(req, res, context, auth, async (agent, requestContext) => {
      const deleted = await context.store.delete(agent.id);
      if (!deleted) {
        writeRegistryProblem(res, 'not-found', { detail: 'Agent not found' });
        return;
      }
      const tenantId = requestContext.tenantId;
      logger.audit('delete_agent', tenantId, `agent:${agent.id}`, 'success');
      taskProjection.purgeAgentTaskState(agent.id);
      emitRegistryEvent(context, { type: 'deleted', id: agent.id });
      res.status(204).send();
    });
  };
  app.delete('/agents/:id', deleteAgent);
  app.delete('/admin/agents/:id', deleteAgent);
}

async function handleAuthorizedAgentRequest(
  req: Request,
  res: Response,
  context: RegistryServerContext,
  auth: RegistryAuthController,
  handler: (agent: RegisteredAgent, requestContext: RequestContext) => Promise<void>,
): Promise<void> {
  const agentId = routeParam(req.params['id']);
  if (!agentId) {
    writeRegistryProblem(res, 'bad-request', { detail: 'Missing agent id' });
    return;
  }

  const requestContext = await auth.authenticateControlPlane(req, res);
  if (!requestContext) {
    return;
  }

  const agent = await context.store.get(agentId);
  if (!agent) {
    writeRegistryProblem(res, 'not-found', { detail: 'Agent not found' });
    return;
  }
  if (!auth.canAccessAgent(agent, requestContext)) {
    writeRegistryProblem(res, 'forbidden', { detail: 'Forbidden' });
    return;
  }

  await handler(agent, requestContext);
}

function emitRegistryEvent(context: RegistryServerContext, payload: unknown): void {
  context.events.emit('registry_update', payload);
}
