import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  hashAgentCard,
  logger,
  normalizeAgentCard,
  verifyAgentCard,
  REGISTRY_EXPORT_SCHEMA_ID,
  RegistryExportDocumentSchema,
  validateUrl,
  type AgentCard,
  type RegistryExportDocument,
  type RequestContext,
  type VerificationKey,
} from '@a2amesh/runtime';
import type { AgentCardVerificationMetadata, RegisteredAgent } from '../storage/IAgentStorage.js';
import type { RegistryAuthController } from './auth.js';
import {
  getAuthorizedAgents,
  registerAgentDiscoveryRoutes,
  routeParam,
} from './agentDiscoveryRoutes.js';
import type { RegistryMetricsController } from './metrics.js';
import { createRegistryOutboundPolicy } from './outboundPolicy.js';
import type { RegistryPollingController } from './polling.js';
import { writeRegistryProblem } from './problems.js';
import type { RegistrySseController } from './sse.js';
import type { RegistryTaskProjectionController } from './taskProjection.js';
import {
  createRegisteredAgentSkills,
  createRegisteredAgentTags,
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

interface RegistryImportResult {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
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

  const registerAgent = async (req: Request, res: Response) => {
    const requestContext = await auth.authenticateControlPlane(req, res);
    if (!requestContext) {
      return;
    }

    const body = req.body as {
      agentUrl?: string;
      agentCard?: AgentCard;
      tenantId?: string;
      isPublic?: boolean;
    };
    const { agentUrl, agentCard, tenantId, isPublic } = body;
    if (!agentUrl || !agentCard) {
      writeRegistryProblem(res, 'bad-request', { detail: 'Missing agentUrl or agentCard' });
      return;
    }

    if (!(await validateAgentUrl(agentUrl, 'registration', context, res))) {
      return;
    }

    const authTenantId = requestContext.tenantId;
    const finalTenantId = authTenantId ?? tenantId;
    if (!isPublicAgentAllowed(finalTenantId, isPublic, context)) {
      writeRegistryProblem(res, 'forbidden', {
        detail: 'Public agent registration is disabled for this tenant',
      });
      return;
    }

    const normalizedCard = normalizeAgentCard(agentCard);
    const verification = await verifyRegistryAgentCard(normalizedCard, finalTenantId, context);
    if (verification.state === 'rejected') {
      writeRegistryProblem(res, 'forbidden', {
        detail: verification.failureReason ?? 'Signed Agent Card verification failed',
      });
      return;
    }

    const registered = await context.store.upsert(
      toRegisteredAgent(agentUrl, normalizedCard, finalTenantId, isPublic, verification),
    );
    context.state.metrics.registrations += 1;
    emitRegistryEvent(context, { type: 'registered', agent: registered });

    if (verification.state === 'trusted' && verification.keyId) {
      const signature = normalizedCard.signatures?.find(
        (candidate) => candidate.keyId === verification.keyId,
      );
      await context.trustLog.append({
        cardHash: hashAgentCard(normalizedCard),
        keyId: verification.keyId,
        algorithm: signature?.algorithm ?? 'unknown',
        agentUrl,
        ...(finalTenantId ? { tenantId: finalTenantId } : {}),
        timestamp: verification.verifiedAt,
      });
    }

    logger.audit('register_agent', finalTenantId, `agent:${registered.id}`, 'success', {
      url: registered.url,
    });
    logger.info('Agent registered', {
      id: registered.id,
      url: registered.url,
      ...(finalTenantId ? { tenantId: finalTenantId } : {}),
    });
    res.status(201).json(registered);
  };
  app.post('/agents/register', registerAgent);
  app.post('/admin/agents/register', registerAgent);

  app.get('/trust-log', async (req, res) => {
    const limitRaw =
      typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : undefined;
    const entries = await context.trustLog.list({
      ...(limitRaw !== undefined && Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
    });
    res.json(entries);
  });

  app.get('/trust-log/:cardHash', async (req, res) => {
    const entries = await context.trustLog.list({ cardHash: req.params['cardHash'] as string });
    res.json(entries);
  });

  registerAgentDiscoveryRoutes(app, context, auth);

  app.get('/admin/agents/export', async (req, res) => {
    const agents = await getAuthorizedAgents(req, res, context, auth);
    if (agents) {
      res.json(createRegistryExportDocument(agents.items));
    }
  });

  app.post('/admin/agents/import', async (req, res) => {
    const requestContext = await auth.authenticateControlPlane(req, res);
    if (!requestContext) {
      return;
    }

    const parsed = RegistryExportDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      writeRegistryProblem(res, 'bad-request', {
        detail: 'Invalid registry export document',
        extensions: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
      return;
    }

    for (const agent of parsed.data.agents) {
      if (!(await validateAgentUrl(agent.url, 'import', context, res))) {
        return;
      }
    }

    res.json(await importRegistryDocument(parsed.data, context, requestContext));
  });

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

  const heartbeatAgent = async (req: Request, res: Response) => {
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

  const deleteAgent = async (req: Request, res: Response) => {
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

function emitRegistryEvent(context: RegistryServerContext, payload: unknown): void {
  context.events.emit('registry_update', payload);
}

function createRegistryExportDocument(agents: RegisteredAgent[]): RegistryExportDocument {
  return {
    $schema: REGISTRY_EXPORT_SCHEMA_ID,
    schemaVersion: '1',
    exportedAt: new Date().toISOString(),
    agents,
    metadata: {
      source: 'a2amesh-registry',
      agentCount: agents.length,
      tenants: uniqueSortedStrings(agents.map((agent) => agent.tenantId)),
      publicAgents: agents.filter((agent) => agent.isPublic === true).length,
    },
  };
}

async function importRegistryDocument(
  document: RegistryExportDocument,
  context: RegistryServerContext,
  requestContext: RequestContext,
): Promise<RegistryImportResult> {
  const agentsByUrl = new Map((await context.store.getAll()).map((agent) => [agent.url, agent]));
  const result: RegistryImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    total: document.agents.length,
  };

  for (const agent of document.agents) {
    const existingById = await context.store.get(agent.id);
    const existing = existingById ?? agentsByUrl.get(agent.url) ?? null;
    if (!isPublicAgentAllowed(requestContext.tenantId ?? agent.tenantId, agent.isPublic, context)) {
      result.skipped += 1;
      continue;
    }

    const importedAgent = await normalizeImportedAgent(
      agent,
      existing?.id ?? agent.id,
      requestContext.tenantId,
      context,
      existing?.verification,
    );

    if (importedAgent.verification?.state === 'rejected') {
      result.skipped += 1;
      continue;
    }

    if (!existing) {
      await context.store.upsert(importedAgent);
      agentsByUrl.set(importedAgent.url, importedAgent);
      result.imported += 1;
      emitRegistryEvent(context, { type: 'imported', agent: importedAgent });
      continue;
    }

    if (areRegisteredAgentsEqual(existing, importedAgent)) {
      result.skipped += 1;
      continue;
    }

    await context.store.upsert(importedAgent);
    agentsByUrl.set(importedAgent.url, importedAgent);
    result.updated += 1;
    emitRegistryEvent(context, { type: 'updated', agent: importedAgent });
  }

  return result;
}

async function normalizeImportedAgent(
  agent: RegistryExportDocument['agents'][number],
  id: string,
  requestTenantId: string | undefined,
  context: RegistryServerContext,
  existingVerification?: AgentCardVerificationMetadata,
): Promise<RegisteredAgent> {
  const card = normalizeAgentCard(agent.card as AgentCard);
  const tenantId = requestTenantId ?? agent.tenantId;
  const verification =
    agent.verification ??
    existingVerification ??
    (await verifyRegistryAgentCard(card, tenantId, context));

  return {
    id,
    url: agent.url,
    card,
    status: agent.status,
    tags: createRegisteredAgentTags(card),
    skills: createRegisteredAgentSkills(card),
    registeredAt: agent.registeredAt,
    ...(agent.lastHeartbeatAt ? { lastHeartbeatAt: agent.lastHeartbeatAt } : {}),
    ...(agent.consecutiveFailures !== undefined
      ? { consecutiveFailures: agent.consecutiveFailures }
      : {}),
    ...(agent.lastSuccessAt ? { lastSuccessAt: agent.lastSuccessAt } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(typeof agent.isPublic === 'boolean' ? { isPublic: agent.isPublic } : {}),
    ...(verification ? { verification } : {}),
  };
}

function areRegisteredAgentsEqual(left: RegisteredAgent, right: RegisteredAgent): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJson(entryValue)]),
  );
}

function uniqueSortedStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function toRegisteredAgent(
  agentUrl: string,
  card: AgentCard,
  tenantId?: string,
  isPublic?: boolean,
  verification?: AgentCardVerificationMetadata,
): RegisteredAgent {
  return {
    id: randomUUID(),
    url: agentUrl,
    card,
    status: 'unknown',
    tags: createRegisteredAgentTags(card),
    skills: createRegisteredAgentSkills(card),
    registeredAt: new Date().toISOString(),
    ...(tenantId ? { tenantId } : {}),
    ...(typeof isPublic === 'boolean' ? { isPublic } : {}),
    ...(verification ? { verification } : {}),
  };
}

async function verifyRegistryAgentCard(
  card: AgentCard,
  tenantId: string | undefined,
  context: RegistryServerContext,
): Promise<AgentCardVerificationMetadata> {
  const policy = tenantId ? context.options.tenantTrustPolicies?.[tenantId] : undefined;
  const required =
    policy?.requireSignedAgentCards ?? context.options.requireSignedAgentCards ?? false;
  const trustedKeys = [
    ...(context.options.trustedAgentCardKeys ?? []),
    ...(policy?.trustedAgentCardKeys ?? []),
  ];
  const verifiedAt = new Date().toISOString();

  if ((card.signatures?.length ?? 0) === 0) {
    return {
      required,
      valid: false,
      state: required ? 'rejected' : 'unverified',
      verifiedAt,
      ...(tenantId ? { tenantId } : {}),
      failureReason: required ? 'Agent Card signature is required' : 'Agent Card is unsigned',
    };
  }

  if (trustedKeys.length === 0) {
    return {
      required,
      valid: false,
      state: required ? 'rejected' : 'unverified',
      verifiedAt,
      ...(tenantId ? { tenantId } : {}),
      failureReason: required
        ? 'No trusted Agent Card verification keys configured'
        : 'No trusted verification key matched',
    };
  }

  const verification = await verifyAgentCard(card, dedupeVerificationKeys(trustedKeys));
  if (!verification.valid) {
    return {
      required,
      valid: false,
      state: required ? 'rejected' : 'unverified',
      verifiedAt,
      ...(tenantId ? { tenantId } : {}),
      failureReason: 'Agent Card signature could not be verified',
    };
  }

  return {
    required,
    valid: true,
    state: 'trusted',
    verifiedAt,
    ...(verification.verifiedKeyId ? { keyId: verification.verifiedKeyId } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

function isPublicAgentAllowed(
  tenantId: string | undefined,
  isPublic: boolean | undefined,
  context: RegistryServerContext,
): boolean {
  if (isPublic !== true || !tenantId) {
    return true;
  }

  return context.options.tenantTrustPolicies?.[tenantId]?.allowPublicAgents !== false;
}

function dedupeVerificationKeys(keys: VerificationKey[]): VerificationKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (seen.has(key.keyId)) {
      return false;
    }
    seen.add(key.keyId);
    return true;
  });
}

async function validateAgentUrl(
  url: string,
  operation: 'registration' | 'import',
  context: RegistryServerContext,
  res: Response,
): Promise<boolean> {
  try {
    await validateUrl(
      url,
      createRegistryOutboundPolicy(context, {
        telemetryLabels: { 'a2a.registry.operation': operation },
      }),
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeRegistryProblem(res, 'bad-request', { detail: `Invalid agentUrl: ${message}` });
    return false;
  }
}

async function handleAuthorizedAgentRequest(
  req: Request,
  res: Response,
  context: RegistryServerContext,
  auth: RegistryAuthController,
  handler: (agent: RegisteredAgent, requestContext: RequestContext) => Promise<void>,
) {
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
