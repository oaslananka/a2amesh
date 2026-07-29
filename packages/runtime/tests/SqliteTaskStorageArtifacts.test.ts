import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
} from '../src/storage/SqliteTaskStorageMigrations.js';
import {
  listArtifactsFromSqlite,
  saveArtifactToSqlite,
  type SqliteArtifactOperationOptions,
} from '../src/storage/SqliteTaskStorageArtifacts.js';
import {
  insertTaskIntoSqlite,
  type SqliteTaskOperationOptions,
} from '../src/storage/SqliteTaskStorageTasks.js';
import type { PersistedTaskArtifact } from '../src/storage/TaskStorageContracts.js';
import type { Task } from '../src/types/task.js';

function createDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:') as unknown as SqliteDatabase;
  initializeSqliteTaskStorage(db, { now: () => new Date('2026-07-30T00:00:00.000Z') });
  return db;
}

function createTask(id: string, tenantId = 'tenant-a'): Task {
  return {
    kind: 'task',
    id,
    status: { state: 'SUBMITTED', timestamp: '2026-07-30T00:00:00.000Z' },
    history: [],
    artifacts: [],
    metadata: { tenantId },
    extensions: [],
  };
}

function artifact(
  taskId: string,
  artifactId: string,
  overrides: Partial<PersistedTaskArtifact> = {},
): PersistedTaskArtifact {
  return {
    taskId,
    artifactId,
    tenantId: 'tenant-a',
    contentType: 'text/plain',
    checksumSha256: 'A'.repeat(64),
    payloadRef: `file:///var/lib/a2amesh/${taskId}/${artifactId}.txt`,
    sizeBytes: 42,
    sensitivity: 'internal',
    redacted: false,
    provenance: { producerId: 'worker-1', taskId },
    createdAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function taskOptions(): SqliteTaskOperationOptions {
  return {
    defaultTenantId: 'default',
    now: () => new Date('2026-07-30T00:00:00.000Z'),
    appendTaskAudit() {},
  };
}

describe('SQLite artifact persistence operations', () => {
  it('validates, upserts, normalizes, orders, and audits persisted artifacts', () => {
    const db = createDatabase();
    insertTaskIntoSqlite(db, createTask('task-a'), taskOptions());
    const appendAuditEntry = vi.fn();
    const now = () => new Date('2026-07-30T00:00:00.000Z');
    const options: SqliteArtifactOperationOptions = { now, appendAuditEntry };

    const inputB = artifact('task-a', 'artifact-b');
    const storedB = saveArtifactToSqlite(db, inputB, options);
    inputB.provenance.producerId = 'mutated';
    expect(storedB.provenance.producerId).toBe('worker-1');
    expect(storedB.checksumSha256).toBe('A'.repeat(64));

    saveArtifactToSqlite(db, artifact('task-a', 'artifact-a'), options);
    saveArtifactToSqlite(
      db,
      artifact('task-a', 'artifact-b', {
        contentType: 'application/json',
        checksumSha256: 'B'.repeat(64),
        sizeBytes: 84,
      }),
      options,
    );

    expect(listArtifactsFromSqlite(db, 'tenant-a', 'task-a')).toEqual([
      expect.objectContaining({ artifactId: 'artifact-a', checksumSha256: 'a'.repeat(64) }),
      expect.objectContaining({
        artifactId: 'artifact-b',
        contentType: 'application/json',
        checksumSha256: 'b'.repeat(64),
        sizeBytes: 84,
      }),
    ]);
    expect(listArtifactsFromSqlite(db, 'tenant-b', 'task-a')).toEqual([]);
    expect(appendAuditEntry).toHaveBeenCalledTimes(3);
    expect(appendAuditEntry).toHaveBeenLastCalledWith(
      {
        taskId: 'task-a',
        tenantId: 'tenant-a',
        action: 'artifact.persisted',
        outcome: 'success',
      },
      now,
    );
    db.close?.();
  });

  it('rejects missing or cross-tenant tasks without emitting audit evidence', () => {
    const db = createDatabase();
    insertTaskIntoSqlite(db, createTask('task-a'), taskOptions());
    const appendAuditEntry = vi.fn();
    const options: SqliteArtifactOperationOptions = {
      now: () => new Date('2026-07-30T00:00:00.000Z'),
      appendAuditEntry,
    };

    expect(() => saveArtifactToSqlite(db, artifact('missing', 'artifact-a'), options)).toThrow(
      'does not exist in the requested tenant',
    );
    expect(() =>
      saveArtifactToSqlite(db, artifact('task-a', 'artifact-a', { tenantId: 'tenant-b' }), options),
    ).toThrow('does not exist in the requested tenant');
    expect(() =>
      saveArtifactToSqlite(
        db,
        artifact('task-a', 'artifact-a', { checksumSha256: 'invalid' }),
        options,
      ),
    ).toThrow('SHA-256');
    expect(appendAuditEntry).not.toHaveBeenCalled();
    db.close?.();
  });
});
