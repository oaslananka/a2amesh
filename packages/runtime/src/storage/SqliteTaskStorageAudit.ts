import type { Task } from '../types/task.js';
import type { SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import { mapAuditRow, type AuditRow } from './SqliteTaskStorageRecords.js';
import type { TaskAuditEntry, TaskAuditInput } from './TaskStorageContracts.js';

export function appendAuditEntryToSqlite(
  db: SqliteDatabase,
  input: TaskAuditInput,
  now: () => Date,
): TaskAuditEntry {
  const timestamp = input.timestamp ?? now().toISOString();
  const result = db
    .prepare(
      'INSERT INTO task_audit_journal (task_id, tenant_id, principal_id, action, outcome, timestamp, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.taskId,
      input.tenantId,
      input.principalId ?? null,
      input.action,
      input.outcome,
      timestamp,
      input.correlationId ?? null,
    );
  return {
    sequence: getSqliteLastInsertRowId(result),
    taskId: input.taskId,
    tenantId: input.tenantId,
    action: input.action,
    outcome: input.outcome,
    timestamp,
    ...(input.principalId ? { principalId: input.principalId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

export function appendTaskAuditFromTaskToSqlite(
  db: SqliteDatabase,
  task: Task,
  tenantId: string,
  action: string,
  outcome: TaskAuditEntry['outcome'],
  now: () => Date,
): TaskAuditEntry {
  const principalId = safeMetadataString(task.metadata?.['principalId']);
  const correlationId = safeMetadataString(task.metadata?.['correlationId']);
  return appendAuditEntryToSqlite(
    db,
    {
      taskId: task.id,
      tenantId,
      action,
      outcome,
      ...(principalId ? { principalId } : {}),
      ...(correlationId ? { correlationId } : {}),
    },
    now,
  );
}

export function listAuditEntriesFromSqlite(
  db: SqliteDatabase,
  tenantId: string,
  taskId?: string,
  limit = 100,
): TaskAuditEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Audit limit must be between 1 and 1000');
  }
  const rows = taskId
    ? db
        .prepare<AuditRow>(
          'SELECT sequence, task_id, tenant_id, principal_id, action, outcome, timestamp, correlation_id FROM task_audit_journal WHERE tenant_id = ? AND task_id = ? ORDER BY sequence LIMIT ?',
        )
        .all(tenantId, taskId, limit)
    : db
        .prepare<AuditRow>(
          'SELECT sequence, task_id, tenant_id, principal_id, action, outcome, timestamp, correlation_id FROM task_audit_journal WHERE tenant_id = ? ORDER BY sequence LIMIT ?',
        )
        .all(tenantId, limit);
  return rows.map(mapAuditRow);
}

function getSqliteLastInsertRowId(result: unknown): number {
  if (result && typeof result === 'object' && 'lastInsertRowid' in result) {
    const value = (result as { lastInsertRowid: unknown }).lastInsertRowid;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number') return value;
  }
  return 0;
}

function safeMetadataString(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().slice(0, 256);
  return /(?:bearer|password|secret|token)[\s:=]/i.test(normalized) ? '[REDACTED]' : normalized;
}
