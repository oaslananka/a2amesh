import type { RegisteredAgent, AgentStatus } from './IAgentStorage.js';

export interface AgentListQuery {
  tenantId?: string | undefined;
  includePublic?: boolean | undefined;
  isPublic?: boolean | undefined;
  skill?: string | undefined;
  tag?: string | undefined;
  name?: string | undefined;
  transport?: 'http' | 'sse' | 'ws' | 'grpc' | undefined;
  status?: AgentStatus | undefined;
  mcpCompatible?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface AgentListResult {
  items: RegisteredAgent[];
  total: number;
  nextCursor: string | null;
}

export interface AgentStorageSummary {
  agentCount: number;
  healthyAgents: number;
  unhealthyAgents: number;
  unknownAgents: number;
  activeTenants: number;
  publicAgents: number;
}

export interface AgentIndexTerms {
  tenantId?: string | undefined;
  status: AgentStatus;
  isPublic: boolean;
  skills: string[];
  tags: string[];
  names: string[];
  transport: string;
  mcpCompatible: boolean;
}

export function buildAgentIndexTerms(agent: RegisteredAgent): AgentIndexTerms {
  return {
    tenantId: agent.tenantId,
    status: agent.status,
    isPublic: agent.isPublic === true,
    skills: uniqueTerms(
      [
        ...agent.skills,
        ...(agent.card.skills ?? []).flatMap((skill) => [skill.name, skill.description]),
      ].flatMap(tokenizeTerms),
    ),
    tags: uniqueTerms([
      ...tokenizeTerms(agent.tags.join(' ')),
      ...(agent.card.skills ?? []).flatMap((skill) => tokenizeTerms((skill.tags ?? []).join(' '))),
    ]),
    names: uniqueTerms(tokenizeTerms(agent.card.name)),
    transport: (agent.card.transport ?? 'http').toLowerCase(),
    mcpCompatible: agent.card.capabilities?.mcpCompatible === true,
  };
}

function tokenizeTerms(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function termMatchesQuery(term: string, query: string): boolean {
  return term.includes(query.toLowerCase());
}

export function matchesVisibility(
  agent: RegisteredAgent,
  query: Pick<AgentListQuery, 'tenantId' | 'includePublic' | 'isPublic'>,
): boolean {
  if (query.isPublic === true) {
    return agent.isPublic === true;
  }
  if (query.tenantId && query.includePublic) {
    return agent.tenantId === query.tenantId || agent.isPublic === true;
  }
  if (query.tenantId) {
    return agent.tenantId === query.tenantId;
  }
  return true;
}

export function applyUpdateStatus(
  current: RegisteredAgent,
  status: AgentStatus,
  meta?: { consecutiveFailures?: number; lastSuccessAt?: string },
): RegisteredAgent {
  return {
    ...current,
    status,
    ...(meta?.consecutiveFailures !== undefined
      ? { consecutiveFailures: meta.consecutiveFailures }
      : {}),
    ...(meta?.lastSuccessAt !== undefined ? { lastSuccessAt: meta.lastSuccessAt } : {}),
  };
}

export function sortAgentsByRegistration(agents: RegisteredAgent[]): RegisteredAgent[] {
  return [...agents].sort((left, right) => {
    const registeredAtDifference = Date.parse(right.registeredAt) - Date.parse(left.registeredAt);
    return registeredAtDifference !== 0 ? registeredAtDifference : left.id.localeCompare(right.id);
  });
}

export function paginateAgents(
  agents: RegisteredAgent[],
  query: Pick<AgentListQuery, 'cursor' | 'limit'>,
): AgentListResult {
  const sortedAgents = sortAgentsByRegistration(agents);
  const parsedCursor = Number(query.cursor ?? '0');
  const offset = Number.isSafeInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const limit = query.limit ?? 50;
  const items = sortedAgents.slice(offset, offset + limit);
  return {
    items,
    total: sortedAgents.length,
    nextCursor: offset + items.length < sortedAgents.length ? String(offset + items.length) : null,
  };
}

export function summarizeAgents(agents: RegisteredAgent[]): AgentStorageSummary {
  const tenantIds = agents
    .map((agent) => agent.tenantId)
    .filter((tenantId): tenantId is string => Boolean(tenantId));
  return {
    agentCount: agents.length,
    healthyAgents: agents.filter((agent) => agent.status === 'healthy').length,
    unhealthyAgents: agents.filter((agent) => agent.status === 'unhealthy').length,
    unknownAgents: agents.filter((agent) => agent.status === 'unknown').length,
    activeTenants: new Set(tenantIds).size,
    publicAgents: agents.filter((agent) => agent.isPublic === true).length,
  };
}
