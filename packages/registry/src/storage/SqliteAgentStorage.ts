import { AgentStorageBase } from './AgentStorageBase.js';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteDatabase, SqliteDatabaseConstructor } from '@a2amesh/runtime';
import type { RegisteredAgent } from './IAgentStorage.js';
import {
  paginateAgents,
  buildAgentIndexTerms,
  matchesVisibility,
  termMatchesQuery,
  type AgentListQuery,
  type AgentListResult,
} from './indexing.js';
import type {
  RegistryDistributedPollingLeaseStore,
  RegistryPollingLeaseRecord,
} from './RedisStorage.js';

interface AgentRow {
  agent_json: string;
}

interface LeaseRow {
  scope: string;
  owner_id: string;
  acquired_at: string;
  expires_at: string;
}

export interface SqliteAgentStorageOptions {
  databaseConstructor?: SqliteDatabaseConstructor | undefined;
  busyTimeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

function loadSqliteDatabase(): SqliteDatabaseConstructor {
  return DatabaseSync as unknown as SqliteDatabaseConstructor;
}

function parseAgent(row: AgentRow | undefined): RegisteredAgent | null {
  return row ? (JSON.parse(row.agent_json) as RegisteredAgent) : null;
}

function matchesQuery(agent: RegisteredAgent, query: AgentListQuery): boolean {
  if (!matchesVisibility(agent, query)) return false;
  const terms = buildAgentIndexTerms(agent);
  if (query.status && agent.status !== query.status) return false;
  const skill = query.skill;
  if (skill && !terms.skills.some((term) => termMatchesQuery(term, skill))) return false;
  const tag = query.tag;
  if (tag && !terms.tags.some((term) => termMatchesQuery(term, tag))) return false;
  const name = query.name;
  if (name && !terms.names.some((term) => termMatchesQuery(term, name))) return false;
  if (query.transport && terms.transport !== query.transport) return false;
  if (query.mcpCompatible !== undefined && terms.mcpCompatible !== query.mcpCompatible)
    return false;
  return true;
}

function initializeDatabase(db: SqliteDatabase, busyTimeoutMs: number): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = ${busyTimeoutMs};
    CREATE TABLE IF NOT EXISTS registry_agents (
      id TEXT PRIMARY KEY,
      agent_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_registry_agents_registered_at
      ON registry_agents(registered_at DESC, id);
    CREATE TABLE IF NOT EXISTS registry_polling_leases (
      scope TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_registry_polling_leases_expires_at
      ON registry_polling_leases(expires_at);
  `);
}

export class SqliteAgentStorage
  extends AgentStorageBase
  implements RegistryDistributedPollingLeaseStore
{
  private readonly db: SqliteDatabase;
  private readonly now: () => Date;

  constructor(path: string, options: SqliteAgentStorageOptions = {}) {
    super();
    const Database = options.databaseConstructor ?? loadSqliteDatabase();
    this.db = new Database(path);
    this.now = options.now ?? (() => new Date());
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new Error('busyTimeoutMs must be a non-negative integer.');
    }
    initializeDatabase(this.db, busyTimeoutMs);
  }

  async upsert(agent: RegisteredAgent): Promise<RegisteredAgent> {
    const updatedAt = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO registry_agents (id, agent_json, registered_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           agent_json = excluded.agent_json,
           registered_at = excluded.registered_at,
           updated_at = excluded.updated_at`,
      )
      .run(agent.id, JSON.stringify(agent), agent.registeredAt, updatedAt);
    return structuredClone(agent);
  }

  async get(id: string): Promise<RegisteredAgent | null> {
    return parseAgent(
      this.db.prepare<AgentRow>('SELECT agent_json FROM registry_agents WHERE id = ?').get(id),
    );
  }

  async getAll(): Promise<RegisteredAgent[]> {
    return this.db
      .prepare<AgentRow>(
        'SELECT agent_json FROM registry_agents ORDER BY registered_at DESC, id ASC',
      )
      .all()
      .map((row) => JSON.parse(row.agent_json) as RegisteredAgent);
  }

  async list(query: AgentListQuery = {}): Promise<AgentListResult> {
    return paginateAgents(
      (await this.getAll()).filter((agent) => matchesQuery(agent, query)),
      query,
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM registry_agents WHERE id = ?').run(id) as {
      changes?: number;
    };
    return (result.changes ?? 0) > 0;
  }

  async acquirePollingLease(scope: string, ownerId: string, ttlMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error('Polling lease TTL must be a positive integer.');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.now();
      const existing = this.db
        .prepare<LeaseRow>(
          'SELECT scope, owner_id, acquired_at, expires_at FROM registry_polling_leases WHERE scope = ?',
        )
        .get(scope);
      if (
        existing &&
        Date.parse(existing.expires_at) > now.getTime() &&
        existing.owner_id !== ownerId
      ) {
        this.db.exec('ROLLBACK');
        return false;
      }

      const acquiredAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      this.db
        .prepare(
          `INSERT INTO registry_polling_leases (scope, owner_id, acquired_at, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(scope) DO UPDATE SET
             owner_id = excluded.owner_id,
             acquired_at = excluded.acquired_at,
             expires_at = excluded.expires_at`,
        )
        .run(scope, ownerId, acquiredAt, expiresAt);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async releasePollingLease(scope: string, ownerId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM registry_polling_leases WHERE scope = ? AND owner_id = ?')
      .run(scope, ownerId);
  }

  async getPollingLease(scope: string): Promise<RegistryPollingLeaseRecord | null> {
    const row = this.db
      .prepare<LeaseRow>(
        'SELECT scope, owner_id, acquired_at, expires_at FROM registry_polling_leases WHERE scope = ?',
      )
      .get(scope);
    return row
      ? {
          scope: row.scope,
          ownerId: row.owner_id,
          acquiredAt: row.acquired_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  close(): void {
    this.db.close?.();
  }
}
