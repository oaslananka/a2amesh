import { describe, expect, it, vi } from 'vitest';
import { StaticWorkerDirectory } from '../src/discovery/WorkerDirectory.js';
import {
  RegistryWorkerDirectory,
  type RegistryDiscoveredAgent,
  type RegistryDiscoverySource,
} from '../src/discovery/RegistryWorkerDirectory.js';
import { routeFleetTask, type FleetRoutingCandidate } from '../src/routing/TaskRouter.js';
import type { FleetRoutingPolicy } from '../src/types/domain.js';

function agent(overrides: Partial<RegistryDiscoveredAgent> = {}): RegistryDiscoveredAgent {
  return {
    id: 'worker-1',
    card: {
      protocolVersion: '1.0',
      name: 'Worker',
      description: 'a worker',
      url: 'http://worker.local',
      version: '1.0.0',
    },
    status: 'healthy',
    skills: ['code-review'],
    registeredAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

function fakeSource(agents: readonly RegistryDiscoveredAgent[]): RegistryDiscoverySource {
  return { listAgents: vi.fn(async () => agents) };
}

function staticCandidate(workerId: string): FleetRoutingCandidate {
  return {
    worker: {
      workerId,
      card: agent().card,
      discoveredAt: '2026-07-05T00:00:00.000Z',
      lastHeartbeatAt: '2026-07-05T00:00:00.000Z',
      status: 'IDLE',
      capabilities: ['code-review'],
      roles: [],
    },
    activeRunCount: 0,
  };
}

const basicPolicy: FleetRoutingPolicy = {
  strategy: { type: 'CAPABILITY_MATCH' },
  requiredSignals: ['capability', 'availability'],
};

describe('RegistryWorkerDirectory', () => {
  it('maps a healthy registered agent into a routable candidate', async () => {
    const source = fakeSource([agent()]);
    const directory = new RegistryWorkerDirectory(source);

    const candidates = await directory.listCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.worker.workerId).toBe('worker-1');
    expect(candidates[0]?.worker.capabilities).toEqual(['code-review']);
    expect(candidates[0]?.worker.status).toBe('IDLE');
    expect(candidates[0]?.activeRunCount).toBe(0);
  });

  it('never surfaces an unhealthy agent as a candidate, so the router cannot dispatch to it', async () => {
    const source = fakeSource([agent({ id: 'worker-unhealthy', status: 'unhealthy' })]);
    const directory = new RegistryWorkerDirectory(source);

    const candidates = await directory.listCandidates();
    expect(candidates).toHaveLength(0);

    const decision = routeFleetTask({ taskId: 't1' }, candidates, basicPolicy);
    expect(decision.selectedWorkerId).toBeUndefined();
  });

  it('evicts an agent whose heartbeat is older than staleAfterMs', async () => {
    const staleHeartbeat = '2026-07-05T00:00:00.000Z';
    const source = fakeSource([agent({ id: 'worker-stale', lastHeartbeatAt: staleHeartbeat })]);
    const directory = new RegistryWorkerDirectory(source, {
      staleAfterMs: 30_000,
      now: () => new Date('2026-07-05T00:05:00.000Z'), // 5 minutes later
    });

    const candidates = await directory.listCandidates();
    expect(candidates).toHaveLength(0);
  });

  it('respects a bounded refresh interval instead of querying the registry on every call', async () => {
    let now = new Date('2026-07-05T00:00:00.000Z');
    const source = fakeSource([agent()]);
    const directory = new RegistryWorkerDirectory(source, {
      refreshIntervalMs: 10_000,
      now: () => now,
    });

    await directory.listCandidates();
    await directory.listCandidates();
    expect(source.listAgents).toHaveBeenCalledTimes(1);

    now = new Date(now.getTime() + 10_000);
    await directory.listCandidates();
    expect(source.listAgents).toHaveBeenCalledTimes(2);
  });

  it('reflects a health-status change (healthy -> unhealthy) once the refresh interval elapses', async () => {
    let now = new Date('2026-07-05T00:00:00.000Z');
    let status: RegistryDiscoveredAgent['status'] = 'healthy';
    const source: RegistryDiscoverySource = {
      listAgents: vi.fn(async () => [agent({ status, lastHeartbeatAt: now.toISOString() })]),
    };
    const directory = new RegistryWorkerDirectory(source, {
      refreshIntervalMs: 5_000,
      now: () => now,
    });

    expect(await directory.listCandidates()).toHaveLength(1);

    status = 'unhealthy';
    now = new Date(now.getTime() + 5_000);
    expect(await directory.listCandidates()).toHaveLength(0);
  });

  it('serves the last known-good candidate set when the registry becomes unreachable', async () => {
    let now = new Date('2026-07-05T00:00:00.000Z');
    let shouldFail = false;
    const source: RegistryDiscoverySource = {
      listAgents: vi.fn(async () => {
        if (shouldFail) throw new Error('registry unreachable');
        return [agent()];
      }),
    };
    const directory = new RegistryWorkerDirectory(source, {
      refreshIntervalMs: 5_000,
      now: () => now,
    });

    expect(await directory.listCandidates()).toHaveLength(1);

    shouldFail = true;
    now = new Date(now.getTime() + 5_000);
    expect(await directory.listCandidates()).toHaveLength(1);
  });

  it('serves the configured fallback when the registry has never been reached', async () => {
    const fallback: FleetRoutingCandidate[] = [staticCandidate('fallback-worker')];
    const source: RegistryDiscoverySource = {
      listAgents: vi.fn(async () => {
        throw new Error('registry unreachable');
      }),
    };
    const directory = new RegistryWorkerDirectory(source, { fallback });

    const candidates = await directory.listCandidates();
    expect(candidates).toEqual(fallback);
  });

  it('isolates candidates by tenant so routeFleetTask can enforce tenant scoping', async () => {
    const source = fakeSource([
      agent({ id: 'tenant-a-worker', tenantId: 'tenant-a' }),
      agent({ id: 'tenant-b-worker', tenantId: 'tenant-b' }),
    ]);
    const directory = new RegistryWorkerDirectory(source);
    const candidates = await directory.listCandidates();

    const tenantScopedPolicy: FleetRoutingPolicy = { ...basicPolicy, tenantScoped: true };
    const decision = routeFleetTask({ taskId: 't1' }, candidates, tenantScopedPolicy, {
      tenantId: 'tenant-a',
    });

    expect(decision.selectedWorkerId).toBe('tenant-a-worker');
  });

  it('reports activeRunCount from the supplied load reporter, honoring concurrency limits', async () => {
    const source = fakeSource([
      agent({
        id: 'busy-worker',
        card: { ...agent().card, maxConcurrentTasks: 1 },
      }),
    ]);
    const directory = new RegistryWorkerDirectory(source, {
      activeRunCounts: () => new Map([['busy-worker', 1]]),
    });

    const candidates = await directory.listCandidates();
    const decision = routeFleetTask({ taskId: 't1' }, candidates, basicPolicy);

    expect(decision.selectedWorkerId).toBeUndefined();
  });

  it('invalidate() forces the next call to bypass the refresh interval', async () => {
    const source = fakeSource([agent()]);
    const directory = new RegistryWorkerDirectory(source, { refreshIntervalMs: 60_000 });

    await directory.listCandidates();
    directory.invalidate();
    await directory.listCandidates();

    expect(source.listAgents).toHaveBeenCalledTimes(2);
  });
});

describe('StaticWorkerDirectory', () => {
  it('preserves the current in-memory-candidate-array behavior unchanged', async () => {
    const candidates: FleetRoutingCandidate[] = [staticCandidate('worker-1')];
    const directory = new StaticWorkerDirectory(candidates);

    await expect(directory.listCandidates()).resolves.toBe(candidates);
  });
});
