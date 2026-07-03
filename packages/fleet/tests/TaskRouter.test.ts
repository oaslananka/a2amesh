import { describe, expect, it } from 'vitest';
import {
  FleetDispatchCycleError,
  planFleetDispatchWaves,
  routeFleetTask,
  type FleetRoutingCandidate,
} from '../src/routing/TaskRouter.js';
import type { FleetRoutingPolicy, FleetWorkerDiscoveryRecord } from '../src/types/domain.js';

function worker(overrides: Partial<FleetWorkerDiscoveryRecord> = {}): FleetWorkerDiscoveryRecord {
  return {
    workerId: 'worker-1',
    card: {
      protocolVersion: '1.0',
      name: 'Worker',
      description: 'a worker',
      url: 'http://worker.local',
      version: '1.0.0',
    },
    discoveredAt: '2026-07-03T00:00:00.000Z',
    lastHeartbeatAt: '2026-07-03T00:00:00.000Z',
    status: 'IDLE',
    capabilities: ['code-review'],
    roles: ['reviewer'],
    ...overrides,
  };
}

function candidate(overrides: Partial<FleetRoutingCandidate> = {}): FleetRoutingCandidate {
  return { worker: worker(), activeRunCount: 0, ...overrides };
}

const basicPolicy: FleetRoutingPolicy = {
  strategy: { type: 'CAPABILITY_MATCH' },
  requiredSignals: ['capability', 'availability'],
};

describe('routeFleetTask', () => {
  it('selects a worker whose capabilities satisfy the task deterministically', () => {
    const candidates = [
      candidate({ worker: worker({ workerId: 'worker-a', capabilities: ['code-review'] }) }),
      candidate({
        worker: worker({ workerId: 'worker-b', capabilities: ['code-review', 'test-execution'] }),
      }),
    ];
    const decision = routeFleetTask(
      { taskId: 'task-1', requiredCapabilities: ['code-review'] },
      candidates,
      basicPolicy,
    );
    expect(decision.selectedWorkerId).toBe('worker-b');
    expect(decision.candidateWorkerIds).toEqual(expect.arrayContaining(['worker-a', 'worker-b']));
  });

  it('reports no eligible worker when no candidate has the required capability', () => {
    const candidates = [candidate({ worker: worker({ capabilities: ['test-execution'] }) })];
    const decision = routeFleetTask(
      { taskId: 'task-1', requiredCapabilities: ['code-review'] },
      candidates,
      basicPolicy,
    );
    expect(decision.selectedWorkerId).toBeUndefined();
    expect(decision.candidateWorkerIds).toEqual([]);
    expect(decision.reason).toContain('no eligible worker');
  });

  it('filters out workers that are offline or over their concurrency limit', () => {
    const candidates = [
      candidate({ worker: worker({ workerId: 'offline', status: 'OFFLINE' }) }),
      candidate({
        worker: worker({
          workerId: 'saturated',
          card: { ...worker().card, maxConcurrentTasks: 1 },
        }),
        activeRunCount: 1,
      }),
      candidate({ worker: worker({ workerId: 'available' }) }),
    ];
    const decision = routeFleetTask({ taskId: 'task-1' }, candidates, basicPolicy);
    expect(decision.selectedWorkerId).toBe('available');
  });

  it('respects workspace scope filtering', () => {
    const candidates = [
      candidate({ worker: worker({ workerId: 'repo-a' }), workspaceScopes: ['repo-a'] }),
      candidate({ worker: worker({ workerId: 'repo-b' }), workspaceScopes: ['repo-b'] }),
    ];
    const decision = routeFleetTask(
      { taskId: 'task-1', workspaceScope: 'repo-b' },
      candidates,
      basicPolicy,
    );
    expect(decision.selectedWorkerId).toBe('repo-b');
  });

  it('denies routing high-risk tasks unless a worker is pre-approved for that risk level', () => {
    const candidates = [
      candidate({ worker: worker({ workerId: 'unapproved' }) }),
      candidate({
        worker: worker({ workerId: 'approved' }),
        approvedForRiskLevels: ['remote-write'],
      }),
    ];
    const decision = routeFleetTask(
      { taskId: 'task-1', riskLevel: 'remote-write' },
      candidates,
      basicPolicy,
    );
    expect(decision.selectedWorkerId).toBe('approved');

    const noneApproved = routeFleetTask(
      { taskId: 'task-2', riskLevel: 'deploy' },
      [candidate({ worker: worker({ workerId: 'unapproved' }) })],
      basicPolicy,
    );
    expect(noneApproved.selectedWorkerId).toBeUndefined();
    expect(noneApproved.reason).toContain('approval required');
  });

  it('is tenant-scoped when the policy requires it', () => {
    const candidates = [
      candidate({ worker: worker({ workerId: 'tenant-a', tenants: ['tenant-a'] }) }),
      candidate({ worker: worker({ workerId: 'tenant-b', tenants: ['tenant-b'] }) }),
    ];
    const decision = routeFleetTask(
      { taskId: 'task-1' },
      candidates,
      { ...basicPolicy, tenantScoped: true },
      { tenantId: 'tenant-b' },
    );
    expect(decision.selectedWorkerId).toBe('tenant-b');
  });
});

describe('planFleetDispatchWaves', () => {
  it('groups independent tasks into a single wave', () => {
    const plan = planFleetDispatchWaves([{ taskId: 'a' }, { taskId: 'b' }, { taskId: 'c' }]);
    expect(plan.waves).toEqual([['a', 'b', 'c']]);
  });

  it('orders dependent tasks into sequential waves', () => {
    const plan = planFleetDispatchWaves([
      { taskId: 'plan' },
      { taskId: 'implement', dependsOn: ['plan'] },
      { taskId: 'test', dependsOn: ['implement'] },
      { taskId: 'lint', dependsOn: ['plan'] },
    ]);
    expect(plan.waves).toEqual([['plan'], ['implement', 'lint'], ['test']]);
  });

  it('throws a structured cycle error when dependencies are circular', () => {
    expect(() =>
      planFleetDispatchWaves([
        { taskId: 'a', dependsOn: ['b'] },
        { taskId: 'b', dependsOn: ['a'] },
      ]),
    ).toThrow(FleetDispatchCycleError);
  });
});
