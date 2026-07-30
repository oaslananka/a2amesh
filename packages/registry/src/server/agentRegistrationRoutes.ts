import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  hashAgentCard,
  logger,
  normalizeAgentCard,
  validateUrl,
  verifyAgentCard,
  type AgentCard,
  type VerificationKey,
} from '@a2amesh/runtime';
import type { AgentCardVerificationMetadata, RegisteredAgent } from '../storage/IAgentStorage.js';
import type { RegistryAuthController } from './auth.js';
import { createRegistryOutboundPolicy } from './outboundPolicy.js';
import { writeRegistryProblem } from './problems.js';
import {
  createRegisteredAgentSkills,
  createRegisteredAgentTags,
  type RegistryServerContext,
} from './types.js';

export function registerAgentRegistrationRoutes(
  app: Express,
  context: RegistryServerContext,
  auth: RegistryAuthController,
): void {
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

    const finalTenantId = requestContext.tenantId ?? tenantId;
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
    context.events.emit('registry_update', { type: 'registered', agent: registered });

    await appendTrustedCardEvidence(normalizedCard, agentUrl, finalTenantId, verification, context);

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
}

export async function verifyRegistryAgentCard(
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
    return unverifiedCardMetadata(
      required,
      verifiedAt,
      tenantId,
      required ? 'Agent Card signature is required' : 'Agent Card is unsigned',
    );
  }

  if (trustedKeys.length === 0) {
    return unverifiedCardMetadata(
      required,
      verifiedAt,
      tenantId,
      required
        ? 'No trusted Agent Card verification keys configured'
        : 'No trusted verification key matched',
    );
  }

  const verification = await verifyAgentCard(card, dedupeVerificationKeys(trustedKeys));
  if (!verification.valid) {
    return unverifiedCardMetadata(
      required,
      verifiedAt,
      tenantId,
      'Agent Card signature could not be verified',
    );
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

export function isPublicAgentAllowed(
  tenantId: string | undefined,
  isPublic: boolean | undefined,
  context: RegistryServerContext,
): boolean {
  if (isPublic !== true || !tenantId) {
    return true;
  }

  return context.options.tenantTrustPolicies?.[tenantId]?.allowPublicAgents !== false;
}

export async function validateAgentUrl(
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

async function appendTrustedCardEvidence(
  card: AgentCard,
  agentUrl: string,
  tenantId: string | undefined,
  verification: AgentCardVerificationMetadata,
  context: RegistryServerContext,
): Promise<void> {
  if (verification.state !== 'trusted' || !verification.keyId) {
    return;
  }

  const signature = card.signatures?.find((candidate) => candidate.keyId === verification.keyId);
  await context.trustLog.append({
    cardHash: hashAgentCard(card),
    keyId: verification.keyId,
    algorithm: signature?.algorithm ?? 'unknown',
    agentUrl,
    ...(tenantId ? { tenantId } : {}),
    timestamp: verification.verifiedAt,
  });
}

function unverifiedCardMetadata(
  required: boolean,
  verifiedAt: string,
  tenantId: string | undefined,
  failureReason: string,
): AgentCardVerificationMetadata {
  return {
    required,
    valid: false,
    state: required ? 'rejected' : 'unverified',
    verifiedAt,
    ...(tenantId ? { tenantId } : {}),
    failureReason,
  };
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
