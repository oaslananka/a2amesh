import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteFleetStorage } from '../src/storage/SqliteFleetStorage.js';
import type { FleetRunRecord } from '../src/storage/IFleetStorage.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'a2amesh-fleet-sqlite-'));
  tempDirectories.push(directory);
  return join(directory, name);
}

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

describe('SqliteFleetStorage', () => {
  it('creates and retrieves a run', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    await storage.createRun(run());

    expect(await storage.getRun('run-1')).toMatchObject({ id: 'run-1', status: 'RUNNING' });
    expect(await storage.getRun('missing')).toBeNull();
    storage.close();
  });

  it('lists runs filtered by status and approvalState', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    await storage.createRun(run({ id: 'run-1', status: 'RUNNING', approvalState: 'NOT_REQUIRED' }));
    await storage.createRun(run({ id: 'run-2', status: 'PENDING', approvalState: 'PENDING' }));

    expect((await storage.listRuns({ status: 'PENDING' })).map((r) => r.id)).toEqual(['run-2']);
    expect((await storage.listRuns({ approvalState: 'NOT_REQUIRED' })).map((r) => r.id)).toEqual([
      'run-1',
    ]);
    expect((await storage.listRuns()).map((r) => r.id).sort()).toEqual(['run-1', 'run-2']);
    storage.close();
  });

  it('updates a run and returns null for an unknown id', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    await storage.createRun(run());

    const updated = await storage.updateRun('run-1', { status: 'COMPLETED' });
    expect(updated?.status).toBe('COMPLETED');
    expect(await storage.updateRun('missing', { status: 'FAILED' })).toBeNull();
    storage.close();
  });

  it('appends artifacts to a run without losing existing ones', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
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
    storage.close();
  });

  it('appends audit entries with a monotonic sequence and lists them in order', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    await storage.appendAudit({ timestamp: 't1', action: 'task-routed', runId: 'run-1' });
    await storage.appendAudit({ timestamp: 't2', action: 'run-completed', runId: 'run-1' });
    await storage.appendAudit({ timestamp: 't3', action: 'task-routed', runId: 'run-2' });

    const all = await storage.listAudit();
    expect(all.map((entry) => entry.sequence)).toEqual([0, 1, 2]);

    const scoped = await storage.listAudit({ runId: 'run-1' });
    expect(scoped.map((entry) => entry.action)).toEqual(['task-routed', 'run-completed']);
    storage.close();
  });

  it('atomically transitions a run only from the expected state', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    await storage.createRun(run({ status: 'PENDING', approvalState: 'PENDING' }));

    const approved = await storage.transitionRun(
      'run-1',
      { status: 'PENDING', approvalState: 'PENDING' },
      { status: 'RUNNING', approvalState: 'APPROVED' },
    );
    expect(approved.outcome).toBe('updated');

    const repeatedApproval = await storage.transitionRun(
      'run-1',
      { status: 'PENDING', approvalState: 'PENDING' },
      { status: 'RUNNING', approvalState: 'APPROVED' },
    );
    expect(repeatedApproval).toMatchObject({
      outcome: 'unchanged',
      run: { status: 'RUNNING', approvalState: 'APPROVED' },
    });

    const rejectedAfterApproval = await storage.transitionRun(
      'run-1',
      { status: 'PENDING', approvalState: 'PENDING' },
      { status: 'FAILED', approvalState: 'REJECTED' },
    );
    expect(rejectedAfterApproval).toMatchObject({
      outcome: 'conflict',
      run: { status: 'RUNNING', approvalState: 'APPROVED' },
    });
    storage.close();
  });

  it('filters runs and audit entries by tenant including unscoped records', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    await storage.createRun(run({ id: 'tenant-a', tenantId: 'tenant-a' }));
    await storage.createRun(run({ id: 'tenant-b', tenantId: 'tenant-b' }));
    await storage.createRun(run({ id: 'unscoped' }));
    await storage.appendAudit({ timestamp: 't1', action: 'task-routed', tenantId: 'tenant-a' });
    await storage.appendAudit({ timestamp: 't2', action: 'task-routed' });

    expect((await storage.listRuns({ tenantId: 'tenant-a' })).map((item) => item.id)).toEqual([
      'tenant-a',
    ]);
    expect((await storage.listRuns({ tenantId: null })).map((item) => item.id)).toEqual([
      'unscoped',
    ]);
    expect(
      (await storage.listAudit({ tenantId: 'tenant-a' })).map((item) => item.timestamp),
    ).toEqual(['t1']);
    expect((await storage.listAudit({ tenantId: null })).map((item) => item.timestamp)).toEqual([
      't2',
    ]);
    storage.close();
  });

  it('limits audit results to the most recent N entries', async () => {
    const storage = new SqliteFleetStorage(databasePath('fleet.db'));
    for (let index = 0; index < 5; index += 1) {
      await storage.appendAudit({ timestamp: `t${index}`, action: 'task-routed' });
    }

    const limited = await storage.listAudit({ limit: 2 });
    expect(limited.map((entry) => entry.sequence)).toEqual([3, 4]);
    storage.close();
  });

  it('migrates an existing schema-v1 database to tenant-aware schema v2', async () => {
    const path = databasePath('legacy-fleet.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE storage_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO storage_schema_migrations (version, applied_at)
      VALUES (1, '2026-07-01T00:00:00.000Z');
      CREATE TABLE fleet_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        approval_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        run_json TEXT NOT NULL
      );
      CREATE TABLE fleet_audit (
        sequence INTEGER PRIMARY KEY,
        run_id TEXT,
        task_id TEXT,
        action TEXT NOT NULL,
        actor TEXT,
        timestamp TEXT NOT NULL,
        detail_json TEXT
      );
    `);
    legacy.close();

    const migrated = new SqliteFleetStorage(path);
    await migrated.createRun(run({ tenantId: 'tenant-a' }));
    await migrated.appendAudit({
      timestamp: 't1',
      action: 'task-routed',
      tenantId: 'tenant-a',
    });

    expect(await migrated.listRuns({ tenantId: 'tenant-a' })).toHaveLength(1);
    expect(await migrated.listAudit({ tenantId: 'tenant-a' })).toHaveLength(1);
    migrated.close();
  });

  it('persists runs and audit entries across a reopen of the same database file', async () => {
    const path = databasePath('fleet.db');
    const first = new SqliteFleetStorage(path);
    await first.createRun(run());
    await first.appendAudit({ timestamp: 't1', action: 'task-routed', runId: 'run-1' });
    first.close();

    const reopened = new SqliteFleetStorage(path);
    expect(await reopened.getRun('run-1')).toMatchObject({ id: 'run-1', status: 'RUNNING' });
    expect((await reopened.listAudit()).map((entry) => entry.sequence)).toEqual([0]);

    const nextAudit = await reopened.appendAudit({ timestamp: 't2', action: 'run-completed' });
    expect(nextAudit.sequence).toBe(1);
    reopened.close();
  });
});
