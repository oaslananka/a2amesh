import type { SqliteDatabase } from './SqliteTaskStorageMigrations.js';
import { getSqliteChanges } from './SqliteTaskStorageRecords.js';
import {
  getTaskFromSqlite,
  taskTenantId,
  type SqliteTaskOperationOptions,
} from './SqliteTaskStorageTasks.js';

export function deleteTaskFromSqlite(
  db: SqliteDatabase,
  taskId: string,
  options: SqliteTaskOperationOptions,
): boolean {
  const task = getTaskFromSqlite(db, taskId);
  db.prepare('DELETE FROM push_notifications WHERE task_id = ?').run(taskId);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  const deleted = getSqliteChanges(result) > 0;
  if (deleted && task) {
    options.appendTaskAudit(
      task,
      taskTenantId(task, options.defaultTenantId),
      'task.deleted',
      'success',
      options.now,
    );
  }
  return deleted;
}

export function clearSqliteTaskStorage(db: SqliteDatabase): void {
  db.prepare('DELETE FROM push_notifications').run();
  db.prepare('DELETE FROM tasks').run();
}
