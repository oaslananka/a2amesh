import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AsyncSqliteTaskStorage,
  SqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorage.js';
import {
  SQLITE_TASK_STORAGE_SCHEMA_VERSION,
  type SqliteStatement,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import type { PersistedTaskArtifact } from '../src/storage/TaskStorageContracts.js';
import type { Task, TaskState } from '../src/types/task.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'a2amesh-sqlite-'));
  tempDirectories.push(directory);
  return join(directory, name);
}

function createTask(
  id: string,
  options: {
    tenantId?: string;
    contextId?: string;
    state?: TaskState;
    timestamp?: string;
    principalId?: string;
    correlationId?: string;
  } = {},
): Task {
  return {
    kind: 'task',
    id,
    status: {
      state: options.state ?? 'SUBMITTED',
      timestamp: options.timestamp ?? '2026-07-03T12:00:00.000Z',
    },
    history: [],
    artifacts: [],
    metadata: {
      tenantId: options.tenantId ?? 'tenant-a',
      ...(options.principalId ? { principalId: options.principalId } : {}),
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    },
    extensions: [],
    ...(options.contextId ? { contextId: options.contextId } : {}),
  };
}

function artifact(
  taskId: string,
  overrides: Partial<PersistedTaskArtifact> = {},
): PersistedTaskArtifact {
  return {
    taskId,
    artifactId: 'artifact-1',
    tenantId: 'tenant-a',
    contentType: 'text/plain',
    checksumSha256: 'a'.repeat(64),
    payloadRef: `file:///var/lib/a2amesh/${taskId}/artifact-1.txt`,
    sizeBytes: 42,
    sensitivity: 'internal',
    redacted: false,
    provenance: { producerId: 'worker-1', taskId },
    createdAt: '2026-07-03T12:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteTaskStorage migrations and operations', () => {
  it('runs ordered migrations, applies WAL/tuning/indexes, and reopens idempotently', () => {
    const path = databasePath('tasks.db');
    const storage = new SqliteTaskStorage(path, { busyTimeoutMs: 2_345 });

    expect(storage.getOperationalState()).toEqual(
      expect.objectContaining({
        schemaVersion: SQLITE_TASK_STORAGE_SCHEMA_VERSION,
        journalMode: 'wal',
        busyTimeoutMs: 2_345,
        indexes: expect.arrayContaining([
          'idx_tasks_context_id',
          'idx_tasks_status',
          'idx_tasks_tenant_id',
          'idx_tasks_updated_at',
          'idx_tasks_tenant_status_updated',
        ]),
      }),
    );
    expect(storage.explainRetentionQueryPlan().join(' ')).toContain(
      'idx_tasks_tenant_status_updated',
    );

    storage.insertTask(createTask('task-1', { contextId: 'ctx-1' }));
    storage.close();

    const reopened = new SqliteTaskStorage(path, { busyTimeoutMs: 2_345 });
    expect(reopened.count()).toBe(1);
    expect(reopened.getTask('task-1')?.contextId).toBe('ctx-1');
    reopened.close();

    const database = new DatabaseSync(path);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM storage_schema_migrations').get(),
    ).toEqual({ count: 3 });
    database.close();
  });

  it('upgrades a legacy database without data loss and rejects future schemas', () => {
    const legacyPath = databasePath('legacy.db');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(
      'CREATE TABLE tasks (id TEXT PRIMARY KEY, context_id TEXT, task_json TEXT NOT NULL);',
    );
    legacy
      .prepare('INSERT INTO tasks (id, context_id, task_json) VALUES (?, ?, ?)')
      .run('legacy-task', 'legacy-context', JSON.stringify(createTask('legacy-task')));
    legacy.close();

    const upgraded = new SqliteTaskStorage(legacyPath);
    expect(upgraded.getOperationalState().schemaVersion).toBe(SQLITE_TASK_STORAGE_SCHEMA_VERSION);
    expect(upgraded.getTask('legacy-task')?.id).toBe('legacy-task');
    upgraded.close();

    const futurePath = databasePath('future.db');
    const future = new DatabaseSync(futurePath);
    future.exec(
      'CREATE TABLE storage_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
    );
    future
      .prepare('INSERT INTO storage_schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(999, '2026-07-03T00:00:00.000Z');
    future.close();

    expect(() => new SqliteTaskStorage(futurePath)).toThrow('newer than supported version 3');
  });

  it('rolls back and reports the exact failed migration', () => {
    class FailingDatabase implements SqliteDatabase {
      static instance: FailingDatabase | undefined;
      readonly inner = new DatabaseSync(':memory:');

      constructor(_path: string) {
        FailingDatabase.instance = this;
      }

      exec(sql: string): void {
        if (sql.includes('CREATE TABLE IF NOT EXISTS task_audit_journal')) {
          throw new Error('injected migration failure');
        }
        this.inner.exec(sql);
      }

      prepare<TRow = unknown>(sql: string): SqliteStatement<TRow> {
        return this.inner.prepare(sql) as unknown as SqliteStatement<TRow>;
      }
    }

    expect(() => new SqliteTaskStorage(':memory:', FailingDatabase)).toThrow('migration 3 failed');
    const database = FailingDatabase.instance?.inner;
    expect(
      database
        ?.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM storage_schema_migrations')
        .get(),
    ).toEqual({ version: 2 });
    expect(
      database
        ?.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'task_audit_journal'")
        .get(),
    ).toEqual({ count: 0 });
    database?.close();
  });

  it('persists tasks and multiple push notification configurations', () => {
    const storage = new SqliteTaskStorage(':memory:');
    const inserted = storage.insertTask(createTask('task-1', { contextId: 'ctx-1' }));
    inserted.metadata = { mutated: true };
    expect(storage.getTask('task-1')?.metadata).toEqual({ tenantId: 'tenant-a' });

    const stored = storage.getTask('task-1');
    if (!stored) throw new Error('task missing');
    stored.contextId = 'ctx-2';
    stored.status.state = 'WORKING';
    storage.saveTask(stored);
    expect(storage.getTasksByContextId('ctx-2')).toHaveLength(1);

    expect(
      storage.setPushNotification('task-1', {
        url: 'https://example.com/default',
        token: 'secret',
      }),
    ).toEqual({ url: 'https://example.com/default', token: 'secret' });
    expect(
      storage.setPushNotificationConfig('task-1', 'email', {
        url: 'https://example.com/email',
      }),
    ).toEqual({ url: 'https://example.com/email' });
    expect(storage.listPushNotifications('task-1')).toHaveLength(2);
    expect(storage.removePushNotificationConfig('task-1', 'email')).toBe(true);
    expect(storage.deleteTask('task-1')).toBe(true);
    expect(storage.count()).toBe(0);
    storage.close();
  });
});

describe('SqliteTaskStorage retention, audit, and artifacts', () => {
  it('cleans only eligible records in one tenant and protects active work', () => {
    const storage = new SqliteTaskStorage(':memory:');
    const old = '2026-07-03T10:00:00.000Z';
    for (const [id, state] of [
      ['completed', 'COMPLETED'],
      ['failed', 'FAILED'],
      ['canceled', 'CANCELED'],
      ['rejected', 'REJECTED'],
      ['paused', 'INPUT_REQUIRED'],
      ['working', 'WORKING'],
    ] as const) {
      storage.insertTask(createTask(id, { state, timestamp: old }));
    }
    storage.insertTask(
      createTask('other-tenant', { tenantId: 'tenant-b', state: 'COMPLETED', timestamp: old }),
    );
    storage.saveArtifact(artifact('completed'));
    storage.setTtl('working', 0, 'tenant-a');

    const result = storage.cleanupRetention({
      tenantId: 'tenant-a',
      completedTtlMs: 1_000,
      failedTtlMs: 1_000,
      canceledTtlMs: 1_000,
      rejectedTtlMs: 1_000,
      stalePausedTtlMs: 1_000,
      now: new Date('2026-07-03T12:00:00.000Z'),
    });

    expect(result).toEqual(
      expect.objectContaining({ deletedTasks: 5, deletedArtifacts: 1, tenantId: 'tenant-a' }),
    );
    expect(storage.getTask('working')).toBeDefined();
    expect(storage.getTask('other-tenant')).toBeDefined();
    expect(storage.listArtifacts('tenant-a', 'completed')).toEqual([]);
    expect(storage.listAuditEntries('tenant-a')).toContainEqual(
      expect.objectContaining({ action: 'retention.cleanup', outcome: 'success' }),
    );
    expect(
      storage.listAuditEntries('tenant-b').some((entry) => entry.action === 'retention.cleanup'),
    ).toBe(false);
    storage.close();
  });

  it('keeps ordered redacted audit evidence and validates artifact integrity', () => {
    const storage = new SqliteTaskStorage(':memory:');
    const task = createTask('audit-task', {
      principalId: 'token: super-secret',
      correlationId: 'request-42',
    });
    storage.insertTask(task);
    task.status.state = 'WORKING';
    storage.saveTask(task);

    const storedArtifact = storage.saveArtifact(artifact(task.id));
    expect(storage.listArtifacts('tenant-a', task.id)).toEqual([storedArtifact]);
    const entries = storage.listAuditEntries('tenant-a', task.id);
    expect(entries.map((entry) => entry.action)).toEqual([
      'task.created',
      'task.transition.SUBMITTED.WORKING',
      'artifact.persisted',
    ]);
    expect(entries.map((entry) => entry.sequence)).toEqual(
      [...entries.map((entry) => entry.sequence)].sort((left, right) => left - right),
    );
    expect(JSON.stringify(entries)).not.toContain('super-secret');
    expect(entries[0]?.principalId).toBe('[REDACTED]');

    expect(() =>
      storage.saveArtifact(
        artifact(task.id, { sensitivity: 'secret', redacted: false, artifactId: 'unsafe-secret' }),
      ),
    ).toThrow('Secret artifacts must be redacted');
    expect(() =>
      storage.saveArtifact(
        artifact(task.id, { checksumSha256: 'invalid', artifactId: 'bad-hash' }),
      ),
    ).toThrow('SHA-256');
    expect(() =>
      storage.saveArtifact(
        artifact(task.id, {
          artifactId: 'unsafe-ref',
          payloadRef: 'https://user:password@example.com/output?token=secret',
        }),
      ),
    ).toThrow('must not contain credentials');
    expect(() =>
      storage.saveArtifact(artifact(task.id, { artifactId: 'wrong-tenant', tenantId: 'tenant-b' })),
    ).toThrow('does not exist in the requested tenant');
    storage.close();
  });

  it('serializes async operations and rolls back transactions', async () => {
    const storage = new AsyncSqliteTaskStorage(':memory:');
    await storage.insertTask(createTask('async-task', { contextId: 'ctx-async' }));
    await storage.transaction(async (transaction) => {
      const task = await transaction.getTask('async-task');
      if (!task) throw new Error('task missing');
      task.status.state = 'WORKING';
      await transaction.saveTask(task);
    });
    await expect(storage.getTask('async-task')).resolves.toEqual(
      expect.objectContaining({ status: expect.objectContaining({ state: 'WORKING' }) }),
    );
    await expect(
      storage.transaction(async () => {
        throw new Error('rollback me');
      }),
    ).rejects.toThrow('rollback me');
    await expect(storage.getOperationalState()).resolves.toEqual(
      expect.objectContaining({
        schemaVersion: SQLITE_TASK_STORAGE_SCHEMA_VERSION,
        journalMode: 'memory',
      }),
    );
    await storage.close();
  });
});
