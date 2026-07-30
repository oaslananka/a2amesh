import type { Express } from 'express';
import {
  normalizeAgentCard,
  REGISTRY_EXPORT_SCHEMA_ID,
  RegistryExportDocumentSchema,
  type AgentCard,
  type RegistryExportDocument,
  type RequestContext,
} from '@a2amesh/runtime';
import type { AgentCardVerificationMetadata, RegisteredAgent } from '../storage/IAgentStorage.js';
import { getAuthorizedAgents } from './agentDiscoveryRoutes.js';
import {
  isPublicAgentAllowed,
  validateAgentUrl,
  verifyRegistryAgentCard,
} from './agentRegistrationRoutes.js';
import type { RegistryAuthController } from './auth.js';
import { writeRegistryProblem } from './problems.js';
import {
  createRegisteredAgentSkills,
  createRegisteredAgentTags,
  type RegistryServerContext,
} from './types.js';

interface RegistryImportResult {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
}

type RegistryImportOutcome = 'imported' | 'updated' | 'skipped';

export function registerRegistryImportExportRoutes(
  app: Express,
  context: RegistryServerContext,
  auth: RegistryAuthController,
): void {
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

    if (!(await validateImportedAgentUrls(parsed.data, context, res))) {
      return;
    }

    res.json(await importRegistryDocument(parsed.data, context, requestContext));
  });
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

async function validateImportedAgentUrls(
  document: RegistryExportDocument,
  context: RegistryServerContext,
  res: Parameters<typeof validateAgentUrl>[3],
): Promise<boolean> {
  for (const agent of document.agents) {
    if (!(await validateAgentUrl(agent.url, 'import', context, res))) {
      return false;
    }
  }
  return true;
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
    const outcome = await importRegistryAgent(agent, context, requestContext, agentsByUrl);
    result[outcome] += 1;
  }

  return result;
}

async function importRegistryAgent(
  agent: RegistryExportDocument['agents'][number],
  context: RegistryServerContext,
  requestContext: RequestContext,
  agentsByUrl: Map<string, RegisteredAgent>,
): Promise<RegistryImportOutcome> {
  const existingById = await context.store.get(agent.id);
  const existing = existingById ?? agentsByUrl.get(agent.url) ?? null;
  if (!isPublicAgentAllowed(requestContext.tenantId ?? agent.tenantId, agent.isPublic, context)) {
    return 'skipped';
  }

  const importedAgent = await normalizeImportedAgent(
    agent,
    existing?.id ?? agent.id,
    requestContext.tenantId,
    context,
    existing?.verification,
  );
  if (importedAgent.verification?.state === 'rejected') {
    return 'skipped';
  }
  if (existing && areRegisteredAgentsEqual(existing, importedAgent)) {
    return 'skipped';
  }

  await context.store.upsert(importedAgent);
  agentsByUrl.set(importedAgent.url, importedAgent);
  const outcome = existing ? 'updated' : 'imported';
  context.events.emit('registry_update', { type: outcome, agent: importedAgent });
  return outcome;
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
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort(
    (left, right) => left.localeCompare(right),
  );
}
