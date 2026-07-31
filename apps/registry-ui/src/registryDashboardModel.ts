import type { RegisteredAgent, RegistryTaskEvent } from './api/registry';

export type RegistryStatusFilter = 'all' | 'healthy' | 'unhealthy' | 'unknown';
export type RegistryCapabilityFilter = 'all' | 'streaming' | 'mcp';

export interface RegistryAgentFilters {
  query: string;
  status: RegistryStatusFilter;
  capability: RegistryCapabilityFilter;
  tenant: string;
}

const ACTIVE_TASK_STATES = new Set([
  'SUBMITTED',
  'QUEUED',
  'WORKING',
  'INPUT_REQUIRED',
  'WAITING_ON_EXTERNAL',
]);

function matchesQuery(agent: RegisteredAgent, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    agent.card.name,
    agent.card.description,
    agent.tenantId,
    ...(agent.card.skills ?? []).map((skill) => `${skill.name} ${(skill.tags ?? []).join(' ')}`),
    ...(agent.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

export function listRegistryTenants(agents: readonly RegisteredAgent[]): string[] {
  return Array.from(
    new Set(
      agents.map((agent) => agent.tenantId).filter((tenant): tenant is string => Boolean(tenant)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function filterRegistryAgents(
  agents: readonly RegisteredAgent[],
  filters: RegistryAgentFilters,
): RegisteredAgent[] {
  return agents.filter((agent) => {
    const matchesStatus = filters.status === 'all' || agent.status === filters.status;
    const matchesCapability =
      filters.capability === 'all' ||
      (filters.capability === 'streaming'
        ? agent.card.capabilities?.streaming === true
        : agent.card.capabilities?.mcpCompatible === true);
    const matchesTenant =
      filters.tenant === 'all' || (agent.tenantId ?? 'unassigned') === filters.tenant;

    return (
      matchesStatus && matchesCapability && matchesTenant && matchesQuery(agent, filters.query)
    );
  });
}

export function countActiveRegistryTasks(
  tasks: readonly RegistryTaskEvent[],
  agentId?: string,
): number {
  return tasks.filter(
    (task) => (!agentId || task.agentId === agentId) && ACTIVE_TASK_STATES.has(task.status),
  ).length;
}

export function formatRelativeTime(timestamp?: string, now = Date.now()): string {
  if (!timestamp) {
    return 'Never';
  }

  const deltaMs = now - Date.parse(timestamp);
  if (!Number.isFinite(deltaMs)) {
    return 'Unknown';
  }

  const deltaMinutes = Math.floor(deltaMs / 60_000);
  if (deltaMinutes < 1) {
    return 'Just now';
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  return `${Math.floor(deltaHours / 24)}d ago`;
}
