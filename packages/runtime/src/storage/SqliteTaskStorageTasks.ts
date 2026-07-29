import type { Task } from '../types/task.js';
import type { SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import { parseTask, type CountRow, type TaskRow } from './SqliteTaskStorageRecords.js';
import type { TaskAuditEntry } from './TaskStorageContracts.js';

export interface SqliteTaskOperationOptions {
  defaultTenantId: string;
  now: () => Date;
  appendTaskAudit: (
    task: Task,
    tenantId: string,
    action: string,
    outcome: TaskAuditEntry['outcome'],
    now: () => Date,
  ) => void;
}

export function insertTaskIntoSqlite(
  db: SqliteDatabase,
  task: Task,
  options: SqliteTaskOperationOptions,
): Task {
  const tenantId = taskTenantId(task, options.defaultTenantId);
  const updatedAt = task.status.timestamp ?? options.now().toISOString();
  db.prepare(
    'INSERT INTO tasks (id, context_id, task_json, tenant_id, status, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    task.id,
    task.contextId ?? null,
    JSON.stringify(task),
    tenantId,
    task.status.state,
    updatedAt,
    null,
  );
  options.appendTaskAudit(task, tenantId, 'task.created', 'success', options.now);
  return structuredClone(task);
}

export function getTaskFromSqlite(db: SqliteDatabase, taskId: string): Task | undefined {
  return parseTask(db.prepare<TaskRow>('SELECT task_json FROM tasks WHERE id = ?').get(taskId));
}

export function saveTaskToSqlite(
  db: SqliteDatabase,
  task: Task,
  options: SqliteTaskOperationOptions,
): void {
  const previous = db
    .prepare<TaskRow>('SELECT task_json, status FROM tasks WHERE id = ?')
    .get(task.id);
  const tenantId = taskTenantId(task, options.defaultTenantId);
  const updatedAt = task.status.timestamp ?? options.now().toISOString();
  db.prepare(
    'UPDATE tasks SET context_id = ?, task_json = ?, tenant_id = ?, status = ?, updated_at = ? WHERE id = ?',
  ).run(
    task.contextId ?? null,
    JSON.stringify(task),
    tenantId,
    task.status.state,
    updatedAt,
    task.id,
  );
  if (previous) {
    const previousTask = parseTask(previous);
    const action =
      previousTask?.status.state === task.status.state
        ? 'task.saved'
        : `task.transition.${previousTask?.status.state ?? 'UNKNOWN'}.${task.status.state}`;
    options.appendTaskAudit(task, tenantId, action, 'success', options.now);
  }
}

export function getAllTasksFromSqlite(db: SqliteDatabase): Task[] {
  return db
    .prepare<TaskRow>('SELECT task_json FROM tasks ORDER BY id')
    .all()
    .map((row) => JSON.parse(row.task_json) as Task);
}

export function getTasksByContextIdFromSqlite(db: SqliteDatabase, contextId: string): Task[] {
  return db
    .prepare<TaskRow>('SELECT task_json FROM tasks WHERE context_id = ? ORDER BY id')
    .all(contextId)
    .map((row) => JSON.parse(row.task_json) as Task);
}

export function countSqliteTasks(db: SqliteDatabase): number {
  const row = db.prepare<CountRow>('SELECT COUNT(*) AS count FROM tasks').get();
  return row?.count ?? 0;
}

export function taskTenantId(task: Task, fallback: string): string {
  const tenantId = task.metadata?.['tenantId'];
  if (typeof tenantId !== 'string' || !tenantId.trim()) return fallback;
  const normalized = tenantId.trim();
  if (normalized.length > 128) throw new Error('Task tenantId exceeds 128 characters');
  return normalized;
}
