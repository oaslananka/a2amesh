import { describe, expect, it } from 'vitest';
import { InMemoryFleetStorage } from '../src/storage/InMemoryFleetStorage.js';
import type { FleetRunRecord } from '../src/storage/IFleetStorage.js';

function run(overrides: Partial<FleetRunRecord> = {}): FleetRunRecord {
  return {
    id: 'run-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    status: 'RUNNING',
    approvalState: 'NOT_REQUIRED',
    routingDecision: {
      taskId: 'task-1',
      selectedWorkerId: 'worker-1',
      candidateWorkerIds: ['worker-1'],
      signals: ['capability'],
      policy: { strategy: { type: 'CAPABILITY_MATCH' }, requiredSignals: ['capability'] },
      reason: 'selected',
      decidedAt: '2026-07-05T00:00:00.000Z',
    },
    artifacts: [],
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('InMemoryFleetStorage', () => {
  it('creates and retrieves a run', async () => {
    const storage = new InMemoryFleetStorage();
    await storage.createRun(run());

    expect(await storage.getRun('run-1')).toMatchObject({ id: 'run-1', status: 'RUNNING' });
    expect(await storage.getRun('missing')).toBeNull();
  });

  it('lists runs filtered by status and approvalState', async () => {
    const storage = new InMemoryFleetStorage();
    await storage.createRun(run({ id: 'run-1', status: 'RUNNING', approvalState: 'NOT_REQUIRED' }));
    await storage.createRun(run({ id: 'run-2', status: 'PENDING', approvalState: 'PENDING' }));

    expect((await storage.listRuns({ status: 'PENDING' })).map((r) => r.id)).toEqual(['run-2']);
    expect((await storage.listRuns({ approvalState: 'NOT_REQUIRED' })).map((r) => r.id)).toEqual([
      'run-1',
    ]);
    expect((await storage.listRuns()).map((r) => r.id).sort()).toEqual(['run-1', 'run-2']);
  });

  it('updates a run and returns null for an unknown id', async () => {
    const storage = new InMemoryFleetStorage();
    await storage.createRun(run());

    const updated = await storage.updateRun('run-1', { status: 'COMPLETED' });
    expect(updated?.status).toBe('COMPLETED');
    expect(await storage.updateRun('missing', { status: 'FAILED' })).toBeNull();
  });

  it('appends artifacts to a run without losing existing ones', async () => {
    const storage = new InMemoryFleetStorage();
    await storage.createRun(run());

    const artifact = {
      artifactId: 'artifact-1',
      kind: 'plan' as const,
      taskId: 'task-1',
      contentType: 'text/markdown',
      sensitivity: 'internal' as const,
      redacted: false,
      provenance: { producerId: 'worker-1', taskId: 'task-1' },
      createdAt: '2026-07-05T00:00:00.000Z',
      content: 'plan content',
    };
    const updated = await storage.addArtifact('run-1', artifact);
    expect(updated?.artifacts).toHaveLength(1);
    expect(await storage.addArtifact('missing', artifact)).toBeNull();
  });

  it('appends audit entries with a monotonic sequence and lists them in order', async () => {
    const storage = new InMemoryFleetStorage();
    await storage.appendAudit({ timestamp: 't1', action: 'task-routed', runId: 'run-1' });
    await storage.appendAudit({ timestamp: 't2', action: 'run-completed', runId: 'run-1' });
    await storage.appendAudit({ timestamp: 't3', action: 'task-routed', runId: 'run-2' });

    const all = await storage.listAudit();
    expect(all.map((entry) => entry.sequence)).toEqual([0, 1, 2]);

    const scoped = await storage.listAudit({ runId: 'run-1' });
    expect(scoped.map((entry) => entry.action)).toEqual(['task-routed', 'run-completed']);
  });

  it('limits audit results to the most recent N entries', async () => {
    const storage = new InMemoryFleetStorage();
    for (let index = 0; index < 5; index += 1) {
      await storage.appendAudit({ timestamp: `t${index}`, action: 'task-routed' });
    }

    const limited = await storage.listAudit({ limit: 2 });
    expect(limited.map((entry) => entry.sequence)).toEqual([3, 4]);
  });
});
