import { DatabaseSync } from 'node:sqlite';
import type { FleetArtifactRecord } from '@a2amesh/internal-fleet';
import type { SqliteDatabase, SqliteDatabaseConstructor } from '@a2amesh/runtime';
import type {
  FleetAuditEntry,
  FleetAuditListFilter,
  FleetRunListFilter,
  FleetRunPatch,
  FleetRunRecord,
  FleetRunTransitionCondition,
  FleetRunTransitionResult,
  IFleetStorage,
} from './IFleetStorage.js';
import {
  initializeSqliteFleetStorage,
  type SqliteFleetStorageMigrationOptions,
} from './SqliteFleetStorageMigrations.js';
import { matchesRunExpectedState, matchesRunTargetState } from './runStateTransitions.js';

export interface SqliteFleetStorageOptions extends SqliteFleetStorageMigrationOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
}

interface RunRow {
  run_json: string;
}

interface AuditRow {
  sequence: number;
  run_id: string | null;
  task_id: string | null;
  action: FleetAuditEntry['action'];
  actor: string | null;
  tenant_id: string | null;
  timestamp: string;
  detail_json: string | null;
}

interface NextSequenceRow {
  next_sequence: number;
}

function loadSqliteDatabase(): SqliteDatabaseConstructor {
  return DatabaseSync as unknown as SqliteDatabaseConstructor;
}

function parseRun(row: RunRow | undefined): FleetRunRecord | null {
  return row ? (JSON.parse(row.run_json) as FleetRunRecord) : null;
}

function upsertRun(db: SqliteDatabase, run: FleetRunRecord): void {
  db.prepare(
    'INSERT INTO fleet_runs (id, task_id, status, approval_state, tenant_id, created_at, updated_at, run_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, status = excluded.status, approval_state = excluded.approval_state, tenant_id = excluded.tenant_id, updated_at = excluded.updated_at, run_json = excluded.run_json',
  ).run(
    run.id,
    run.taskId,
    run.status,
    run.approvalState,
    run.tenantId ?? null,
    run.createdAt,
    run.updatedAt,
    JSON.stringify(run),
  );
}

function createRun(db: SqliteDatabase, run: FleetRunRecord): FleetRunRecord {
  const stored = { ...run };
  upsertRun(db, stored);
  return { ...stored };
}

function getRun(db: SqliteDatabase, id: string): FleetRunRecord | null {
  return parseRun(db.prepare<RunRow>('SELECT run_json FROM fleet_runs WHERE id = ?').get(id));
}

function listRuns(db: SqliteDatabase, filter: FleetRunListFilter): FleetRunRecord[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.approvalState) {
    conditions.push('approval_state = ?');
    params.push(filter.approvalState);
  }
  if (filter.tenantId === null) {
    conditions.push('tenant_id IS NULL');
  } else if (filter.tenantId !== undefined) {
    conditions.push('tenant_id = ?');
    params.push(filter.tenantId);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare<RunRow>(`SELECT run_json FROM fleet_runs${where} ORDER BY created_at ASC`)
    .all(...params);
  return rows.map((row) => parseRun(row)).filter((run): run is FleetRunRecord => run !== null);
}

function updateRun(db: SqliteDatabase, id: string, patch: FleetRunPatch): FleetRunRecord | null {
  const existing = getRun(db, id);
  if (!existing) {
    return null;
  }
  const updated = { ...existing, ...patch };
  upsertRun(db, updated);
  return { ...updated };
}

function transitionRun(
  db: SqliteDatabase,
  id: string,
  expected: FleetRunTransitionCondition,
  patch: FleetRunPatch,
): FleetRunTransitionResult {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = getRun(db, id);
    if (!existing) {
      db.exec('COMMIT');
      return { outcome: 'not-found' };
    }
    if (!matchesRunExpectedState(existing, expected)) {
      db.exec('COMMIT');
      return matchesRunTargetState(existing, patch)
        ? { outcome: 'unchanged', run: existing }
        : { outcome: 'conflict', run: existing };
    }
    const updated = { ...existing, ...patch };
    upsertRun(db, updated);
    db.exec('COMMIT');
    return { outcome: 'updated', run: { ...updated } };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function addArtifact(
  db: SqliteDatabase,
  runId: string,
  artifact: FleetArtifactRecord,
): FleetRunRecord | null {
  const existing = getRun(db, runId);
  if (!existing) {
    return null;
  }
  const updated = { ...existing, artifacts: [...existing.artifacts, artifact] };
  upsertRun(db, updated);
  return { ...updated };
}

function getNextAuditSequence(db: SqliteDatabase): number {
  const row = db
    .prepare<NextSequenceRow>(
      'SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence FROM fleet_audit',
    )
    .get();
  return row?.next_sequence ?? 0;
}

function appendAudit(
  db: SqliteDatabase,
  entry: Omit<FleetAuditEntry, 'sequence'>,
): FleetAuditEntry {
  const sequence = getNextAuditSequence(db);
  db.prepare(
    'INSERT INTO fleet_audit (sequence, run_id, task_id, action, actor, tenant_id, timestamp, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sequence,
    entry.runId ?? null,
    entry.taskId ?? null,
    entry.action,
    entry.actor ?? null,
    entry.tenantId ?? null,
    entry.timestamp,
    entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
  );
  return { ...entry, sequence };
}

function mapAuditRow(row: AuditRow): FleetAuditEntry {
  return {
    sequence: row.sequence,
    action: row.action,
    timestamp: row.timestamp,
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.task_id !== null ? { taskId: row.task_id } : {}),
    ...(row.actor !== null ? { actor: row.actor } : {}),
    ...(row.tenant_id !== null ? { tenantId: row.tenant_id } : {}),
    ...(row.detail_json !== null
      ? { detail: JSON.parse(row.detail_json) as Record<string, unknown> }
      : {}),
  };
}

function listAudit(db: SqliteDatabase, filter: FleetAuditListFilter): FleetAuditEntry[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filter.runId) {
    conditions.push('run_id = ?');
    params.push(filter.runId);
  }
  if (filter.tenantId === null) {
    conditions.push('tenant_id IS NULL');
  } else if (filter.tenantId !== undefined) {
    conditions.push('tenant_id = ?');
    params.push(filter.tenantId);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ? ' LIMIT ?' : '';
  if (filter.limit) {
    params.push(filter.limit);
  }
  const rows = db
    .prepare<AuditRow>(
      `SELECT sequence, run_id, task_id, action, actor, tenant_id, timestamp, detail_json FROM fleet_audit${where} ORDER BY sequence DESC${limit}`,
    )
    .all(...params);
  return rows.map(mapAuditRow).reverse();
}

/** SQLite-backed `IFleetStorage`. */
export class SqliteFleetStorage implements IFleetStorage {
  private readonly db: SqliteDatabase;

  constructor(
    path: string,
    databaseConstructorOrOptions?: SqliteDatabaseConstructor | SqliteFleetStorageOptions,
  ) {
    const options =
      typeof databaseConstructorOrOptions === 'function'
        ? { databaseConstructor: databaseConstructorOrOptions }
        : (databaseConstructorOrOptions ?? {});
    const Database = options.databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    initializeSqliteFleetStorage(this.db, options);
  }

  async createRun(run: FleetRunRecord): Promise<FleetRunRecord> {
    return createRun(this.db, run);
  }

  async getRun(id: string): Promise<FleetRunRecord | null> {
    return getRun(this.db, id);
  }

  async listRuns(filter: FleetRunListFilter = {}): Promise<FleetRunRecord[]> {
    return listRuns(this.db, filter);
  }

  async updateRun(id: string, patch: FleetRunPatch): Promise<FleetRunRecord | null> {
    return updateRun(this.db, id, patch);
  }

  async transitionRun(
    id: string,
    expected: FleetRunTransitionCondition,
    patch: FleetRunPatch,
  ): Promise<FleetRunTransitionResult> {
    return transitionRun(this.db, id, expected, patch);
  }

  async addArtifact(runId: string, artifact: FleetArtifactRecord): Promise<FleetRunRecord | null> {
    return addArtifact(this.db, runId, artifact);
  }

  async appendAudit(entry: Omit<FleetAuditEntry, 'sequence'>): Promise<FleetAuditEntry> {
    return appendAudit(this.db, entry);
  }

  async listAudit(filter: FleetAuditListFilter = {}): Promise<FleetAuditEntry[]> {
    return listAudit(this.db, filter);
  }

  close(): void {
    this.db.close?.();
  }
}
