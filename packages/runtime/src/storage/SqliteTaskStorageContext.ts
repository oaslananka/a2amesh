import { DatabaseSync } from 'node:sqlite';
import {
  appendAuditEntryToSqlite,
  appendTaskAuditFromTaskToSqlite,
} from './SqliteTaskStorageAudit.js';
import type { SqliteArtifactOperationOptions } from './SqliteTaskStorageArtifacts.js';
import {
  initializeSqliteTaskStorage,
  type SqliteDatabase,
  type SqliteDatabaseConstructor,
} from './SqliteTaskStorageMigrations.js';
import type { SqliteRetentionOperationOptions } from './SqliteTaskStorageRetention.js';
import type { SqliteTaskOperationOptions } from './SqliteTaskStorageTasks.js';

export interface SqliteTaskStorageOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
  busyTimeoutMs?: number | undefined;
  defaultTenantId?: string | undefined;
  now?: (() => Date) | undefined;
}

interface NormalizedSqliteTaskStorageOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
  busyTimeoutMs: number;
  defaultTenantId: string;
  now: () => Date;
}

export interface SqliteTaskStorageContext {
  db: SqliteDatabase;
  options: NormalizedSqliteTaskStorageOptions;
  taskOptions: SqliteTaskOperationOptions;
  retentionOptions: SqliteRetentionOperationOptions;
  artifactOptions: SqliteArtifactOperationOptions;
}

function createAuditEntryAppender(
  db: SqliteDatabase,
): SqliteArtifactOperationOptions['appendAuditEntry'] {
  return (input, now) => {
    appendAuditEntryToSqlite(db, input, now);
  };
}

function createArtifactOperationOptions(
  db: SqliteDatabase,
  options: NormalizedSqliteTaskStorageOptions,
): SqliteArtifactOperationOptions {
  return { now: options.now, appendAuditEntry: createAuditEntryAppender(db) };
}

function createRetentionOperationOptions(
  db: SqliteDatabase,
  options: NormalizedSqliteTaskStorageOptions,
): SqliteRetentionOperationOptions {
  return { now: options.now, appendAuditEntry: createAuditEntryAppender(db) };
}

function createTaskOperationOptions(
  db: SqliteDatabase,
  options: NormalizedSqliteTaskStorageOptions,
): SqliteTaskOperationOptions {
  return {
    defaultTenantId: options.defaultTenantId,
    now: options.now,
    appendTaskAudit(task, tenantId, action, outcome, now) {
      appendTaskAuditFromTaskToSqlite(db, task, tenantId, action, outcome, now);
    },
  };
}

export function createSqliteTaskStorageContext(
  path: string,
  databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
): SqliteTaskStorageContext {
  const options = normalizeSqliteOptions(databaseConstructorOrOptions);
  const Database = options.databaseConstructor ?? loadSqliteDatabase();
  const db = new Database(path);
  const taskOptions = createTaskOperationOptions(db, options);
  const retentionOptions = createRetentionOperationOptions(db, options);
  const artifactOptions = createArtifactOperationOptions(db, options);
  initializeSqliteTaskStorage(db, options);
  return { db, options, taskOptions, retentionOptions, artifactOptions };
}

function loadSqliteDatabase(): SqliteDatabaseConstructor {
  return DatabaseSync as unknown as SqliteDatabaseConstructor;
}

function normalizeSqliteOptions(
  input?: SqliteDatabaseConstructor | SqliteTaskStorageOptions,
): NormalizedSqliteTaskStorageOptions {
  const options = typeof input === 'function' ? { databaseConstructor: input } : (input ?? {});
  const defaultTenantId = options.defaultTenantId?.trim() || 'default';
  return {
    databaseConstructor: options.databaseConstructor,
    busyTimeoutMs: options.busyTimeoutMs ?? 5_000,
    defaultTenantId,
    now: options.now ?? (() => new Date()),
  };
}
