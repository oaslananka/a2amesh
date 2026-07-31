import { describe, expect, it } from 'vitest';
import {
  completedTask,
  publicAgent,
  researcherAgent,
  workingTask,
  writerAgent,
} from './test/fixtures';
import {
  countActiveRegistryTasks,
  filterRegistryAgents,
  formatRelativeTime,
  listRegistryTenants,
} from './registryDashboardModel';

describe('registry dashboard model', () => {
  const agents = [researcherAgent, writerAgent, publicAgent];

  it('derives sorted unique tenant filters', () => {
    expect(listRegistryTenants(agents)).toEqual(['tenant-a']);
  });

  it('filters agents by query, health, capability, and tenant', () => {
    expect(
      filterRegistryAgents(agents, {
        query: 'sources',
        status: 'healthy',
        capability: 'mcp',
        tenant: 'tenant-a',
      }),
    ).toEqual([researcherAgent]);

    expect(
      filterRegistryAgents(agents, {
        query: 'public discovery',
        status: 'all',
        capability: 'all',
        tenant: 'unassigned',
      }),
    ).toEqual([publicAgent]);
  });

  it('counts active tasks for the fleet or one agent', () => {
    const tasks = [completedTask, workingTask];
    expect(countActiveRegistryTasks(tasks)).toBe(1);
    expect(countActiveRegistryTasks(tasks, writerAgent.id)).toBe(1);
    expect(countActiveRegistryTasks(tasks, researcherAgent.id)).toBe(0);
  });

  it('formats relative timestamps deterministically', () => {
    const now = Date.parse('2026-04-06T10:05:00.000Z');
    expect(formatRelativeTime(undefined, now)).toBe('Never');
    expect(formatRelativeTime('invalid', now)).toBe('Unknown');
    expect(formatRelativeTime('2026-04-06T10:04:45.000Z', now)).toBe('Just now');
    expect(formatRelativeTime('2026-04-06T10:00:00.000Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-04-06T08:05:00.000Z', now)).toBe('2h ago');
    expect(formatRelativeTime('2026-04-04T10:05:00.000Z', now)).toBe('2d ago');
  });
});
