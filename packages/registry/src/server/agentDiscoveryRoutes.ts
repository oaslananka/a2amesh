import type { Express, Request, Response } from 'express';
import type { AgentListQuery, AgentListResult } from '../storage/indexing.js';
import type { RegistryAuthController } from './auth.js';
import { writeRegistryProblem } from './problems.js';
import type { RegistryServerContext } from './types.js';

export function registerAgentDiscoveryRoutes(
  app: Express,
  context: RegistryServerContext,
  auth: RegistryAuthController,
): void {
  app.get('/agents', async (req, res) => {
    const pagination = resolveAgentPagination(req);
    if (req.query['public'] === 'true') {
      writeAgentList(
        res,
        await context.store.list({
          isPublic: true,
          ...pagination,
        }),
      );
      return;
    }

    const agents = await getAuthorizedAgents(req, res, context, auth, pagination);
    if (agents) {
      writeAgentList(res, agents);
    }
  });

  app.get('/agents/search', async (req, res) => {
    const query = resolveAgentSearchQuery(req);
    if (!query) {
      writeRegistryProblem(res, 'bad-request', {
        detail:
          'At least one filter (skill, tag, name, transport, status, mcpCompatible) is required',
      });
      return;
    }

    context.state.metrics.searches += 1;
    if (req.query['public'] === 'true') {
      writeAgentList(res, await context.store.list({ ...query, isPublic: true }));
      return;
    }

    const agents = await getAuthorizedAgents(req, res, context, auth, query);
    if (agents) {
      writeAgentList(res, agents);
    }
  });

  app.get('/agents/:id', async (req, res) => {
    const agentId = routeParam(req.params['id']);
    if (!agentId) {
      writeRegistryProblem(res, 'bad-request', { detail: 'Missing agent id' });
      return;
    }

    const agent = await context.store.get(agentId);
    if (!agent) {
      writeRegistryProblem(res, 'not-found', { detail: 'Agent not found' });
      return;
    }
    if (!agent.isPublic) {
      const requestContext = await auth.authenticateControlPlane(req, res);
      if (!requestContext) {
        return;
      }
      if (!auth.canAccessAgent(agent, requestContext)) {
        writeRegistryProblem(res, 'forbidden', { detail: 'Forbidden' });
        return;
      }
    }
    res.json(agent);
  });
}

export function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveAgentPagination(req: Request): Pick<AgentListQuery, 'cursor' | 'limit'> {
  const rawLimit = Array.isArray(req.query['limit']) ? req.query['limit'][0] : req.query['limit'];
  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : undefined;
  const rawCursor = Array.isArray(req.query['cursor'])
    ? req.query['cursor'][0]
    : req.query['cursor'];
  return {
    ...(typeof rawCursor === 'string' && rawCursor.trim().length > 0
      ? { cursor: rawCursor.trim() }
      : {}),
    ...(limit !== undefined && Number.isFinite(limit) && limit > 0
      ? { limit: Math.floor(limit) }
      : { limit: Number.MAX_SAFE_INTEGER }),
  };
}

function resolveAgentSearchQuery(req: Request): AgentListQuery | undefined {
  const query: AgentListQuery = resolveAgentPagination(req);
  const skill = queryString(req.query['skill']);
  const tag = queryString(req.query['tag']);
  const name = queryString(req.query['name']);
  const transport = req.query['transport'] as AgentListQuery['transport'];
  const status = req.query['status'] as AgentListQuery['status'];
  const mcpCompatible = optionalBoolean(req.query['mcpCompatible']);

  if (skill) query.skill = skill;
  if (tag) query.tag = tag;
  if (name) query.name = name;
  if (transport) query.transport = transport;
  if (status) query.status = status;
  if (mcpCompatible !== undefined) query.mcpCompatible = mcpCompatible;

  return skill || tag || name || transport || status || mcpCompatible !== undefined
    ? query
    : undefined;
}

function queryString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function writeAgentList(res: Response, result: AgentListResult): void {
  res.setHeader('X-A2A-Registry-Page-Total', String(result.total));
  res.setHeader('X-A2A-Registry-Page-Count', String(result.items.length));
  if (result.nextCursor) {
    res.setHeader('X-A2A-Registry-Page-Next-Cursor', result.nextCursor);
  }
  res.json(result.items);
}

export async function getAuthorizedAgents(
  req: Request,
  res: Response,
  context: RegistryServerContext,
  auth: RegistryAuthController,
  query?: AgentListQuery,
): Promise<AgentListResult | undefined> {
  const requestContext = await auth.authenticateControlPlane(req, res);
  if (!requestContext) {
    return undefined;
  }

  const result = await context.store.list({
    ...(query ?? { limit: Number.MAX_SAFE_INTEGER }),
    ...(requestContext.tenantId ? { tenantId: requestContext.tenantId, includePublic: true } : {}),
  });

  if (!auth.shouldEnforceTenantIsolation(requestContext)) {
    return result;
  }

  return {
    ...result,
    items: auth.filterAgentsByContext(result.items, requestContext),
  };
}
