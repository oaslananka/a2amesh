import type { SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import {
  getSqliteChanges,
  parseTask,
  type CountRow,
  type TaskRow,
} from './SqliteTaskStorageRecords.js';
import type {
  TaskAuditInput,
  TaskCleanupResult,
  TaskRetentionPolicy,
} from './TaskStorageContracts.js';

export interface SqliteRetentionOperationOptions {
  now: () => Date;
  appendAuditEntry: (input: TaskAuditInput, now: () => Date) => void;
}

export function setTaskTtl(
  db: SqliteDatabase,
  taskId: string,
  tenantId: string,
  ttlMs: number,
  now: () => Date,
): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0) {
    throw new Error('ttlMs must be a non-negative integer');
  }
  db.prepare('UPDATE tasks SET expires_at = ? WHERE id = ? AND tenant_id = ?').run(
    new Date(now().getTime() + ttlMs).toISOString(),
    taskId,
    tenantId,
  );
}

export function cleanupRetainedTasks(
  db: SqliteDatabase,
  policy: TaskRetentionPolicy,
  options: SqliteRetentionOperationOptions,
): TaskCleanupResult {
  const evaluatedAt = (policy.now ?? options.now()).toISOString();
  const evaluatedMs = Date.parse(evaluatedAt);
  const rows = db
    .prepare<TaskRow>(
      'SELECT task_json, tenant_id, status, updated_at, expires_at FROM tasks WHERE tenant_id = ?',
    )
    .all(policy.tenantId);
  const eligible = rows.filter((row) => isRetentionEligible(row, policy, evaluatedMs));
  let deletedArtifacts = 0;
  let deletedTasks = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of eligible) {
      const task = parseTask(row);
      if (!task) continue;
      deletedArtifacts +=
        db
          .prepare<CountRow>(
            'SELECT COUNT(*) AS count FROM task_artifacts WHERE tenant_id = ? AND task_id = ?',
          )
          .get(policy.tenantId, task.id)?.count ?? 0;
      deletedTasks += getSqliteChanges(
        db
          .prepare('DELETE FROM tasks WHERE id = ? AND tenant_id = ?')
          .run(task.id, policy.tenantId),
      );
    }
    options.appendAuditEntry(
      {
        taskId: '*',
        tenantId: policy.tenantId,
        action: 'retention.cleanup',
        outcome: 'success',
        correlationId: `deleted-tasks:${deletedTasks};deleted-artifacts:${deletedArtifacts}`,
        timestamp: evaluatedAt,
      },
      options.now,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { tenantId: policy.tenantId, deletedTasks, deletedArtifacts, evaluatedAt };
}

export function explainRetentionQueryPlan(db: SqliteDatabase): string[] {
  return db
    .prepare<{ detail: string }>(
      'EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE tenant_id = ? AND status = ? AND updated_at < ?',
    )
    .all('tenant', 'COMPLETED', '2100-01-01T00:00:00.000Z')
    .map((row) => row.detail);
}

function isRetentionEligible(
  row: TaskRow,
  policy: TaskRetentionPolicy,
  evaluatedMs: number,
): boolean {
  const status = row.status ?? parseTask(row)?.status.state;
  if (!status || ['SUBMITTED', 'QUEUED', 'WORKING'].includes(status)) return false;
  if (row.expires_at && Date.parse(row.expires_at) <= evaluatedMs) return true;
  const ttlMs = retentionTtlMs(status, policy);
  if (ttlMs === undefined || !Number.isSafeInteger(ttlMs) || ttlMs < 0) return false;
  const updatedMs = Date.parse(row.updated_at ?? parseTask(row)?.status.timestamp ?? '');
  return Number.isFinite(updatedMs) && updatedMs + ttlMs <= evaluatedMs;
}

function retentionTtlMs(
  status: NonNullable<TaskRow['status']>,
  policy: TaskRetentionPolicy,
): number | undefined {
  switch (status) {
    case 'COMPLETED':
      return policy.completedTtlMs;
    case 'FAILED':
      return policy.failedTtlMs;
    case 'CANCELED':
      return policy.canceledTtlMs;
    case 'REJECTED':
      return policy.rejectedTtlMs;
    case 'INPUT_REQUIRED':
    case 'AUTH_REQUIRED':
    case 'WAITING_ON_EXTERNAL':
      return policy.stalePausedTtlMs;
    default:
      return undefined;
  }
}
