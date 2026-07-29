import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import {
  cleanupRetainedTasks,
  explainRetentionQueryPlan,
  setTaskTtl,
  type SqliteRetentionOperationOptions,
} from '../src/storage/SqliteTaskStorageRetention.js';
import { insertTaskIntoSqlite } from '../src/storage/SqliteTaskStorageTasks.js';
import type { Task } from '../src/types/task.js';

function createDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
  initializeSqliteTaskStorage(db, { now: () => new Date('2026-07-29T18:00:00.000Z') });
  return db;
}

function createTask(
  id: string,
  options: {
    tenantId?: string;
    state?: Task['status']['state'];
    timestamp?: string;
  } = {},
): Task {
  return {
    kind: 'task',
    id,
    status: {
      state: options.state ?? 'SUBMITTED',
      timestamp: options.timestamp ?? '2026-07-29T18:00:00.000Z',
    },
    history: [],
    artifacts: [],
    metadata: { tenantId: options.tenantId ?? 'tenant-a' },
    extensions: [],
  };
}

function insertTask(db: SqliteDatabase, task: Task): void {
  insertTaskIntoSqlite(db, task, {
    defaultTenantId: 'default',
    now: () => new Date('2026-07-29T18:00:00.000Z'),
    appendTaskAudit() {},
  });
}

function insertArtifact(db: SqliteDatabase, taskId: string): void {
  db.prepare(
    'INSERT INTO task_artifacts (task_id, artifact_id, tenant_id, content_type, checksum_sha256, payload_ref, size_bytes, sensitivity, redacted, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    taskId,
    'artifact-1',
    'tenant-a',
    'application/json',
    'a'.repeat(64),
    'memory://artifact-1',
    16,
    'internal',
    0,
    JSON.stringify({ taskId, producerId: 'test' }),
    '2026-07-29T18:00:00.000Z',
  );
}

describe('SQLite retention operations', () => {
  it('validates TTL values and scopes expiry updates to the selected tenant', () => {
    const db = createDatabase();
    insertTask(db, createTask('task-a'));
    const now = () => new Date('2026-07-29T20:00:00.000Z');

    expect(() => setTaskTtl(db, 'task-a', 'tenant-a', -1, now)).toThrow(
      'ttlMs must be a non-negative integer',
    );
    setTaskTtl(db, 'task-a', 'tenant-b', 1_000, now);
    expect(
      db
        .prepare<{ expires_at: string | null }>('SELECT expires_at FROM tasks WHERE id = ?')
        .get('task-a'),
    ).toEqual({ expires_at: null });

    setTaskTtl(db, 'task-a', 'tenant-a', 1_000, now);
    expect(
      db
        .prepare<{ expires_at: string | null }>('SELECT expires_at FROM tasks WHERE id = ?')
        .get('task-a'),
    ).toEqual({ expires_at: '2026-07-29T20:00:01.000Z' });
    db.close?.();
  });

  it('cleans only eligible tenant records and emits bounded cleanup evidence', () => {
    const db = createDatabase();
    const old = '2026-07-29T18:00:00.000Z';
    insertTask(db, createTask('completed', { state: 'COMPLETED', timestamp: old }));
    insertTask(db, createTask('working', { state: 'WORKING', timestamp: old }));
    insertTask(
      db,
      createTask('other-tenant', {
        tenantId: 'tenant-b',
        state: 'COMPLETED',
        timestamp: old,
      }),
    );
    insertArtifact(db, 'completed');

    const appendAuditEntry = vi.fn<SqliteRetentionOperationOptions['appendAuditEntry']>();
    const options = {
      now: () => new Date('2026-07-29T20:00:00.000Z'),
      appendAuditEntry,
    };
    const result = cleanupRetainedTasks(
      db,
      {
        tenantId: 'tenant-a',
        completedTtlMs: 1_000,
        now: new Date('2026-07-29T20:00:00.000Z'),
      },
      options,
    );

    expect(result).toEqual({
      tenantId: 'tenant-a',
      deletedTasks: 1,
      deletedArtifacts: 1,
      evaluatedAt: '2026-07-29T20:00:00.000Z',
    });
    expect(db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({
      count: 2,
    });
    expect(
      db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM task_artifacts').get(),
    ).toEqual({ count: 0 });
    expect(appendAuditEntry).toHaveBeenCalledWith(
      {
        taskId: '*',
        tenantId: 'tenant-a',
        action: 'retention.cleanup',
        outcome: 'success',
        correlationId: 'deleted-tasks:1;deleted-artifacts:1',
        timestamp: '2026-07-29T20:00:00.000Z',
      },
      options.now,
    );
    expect(explainRetentionQueryPlan(db)).toEqual(expect.arrayContaining([expect.any(String)]));
    db.close?.();
  });
});
