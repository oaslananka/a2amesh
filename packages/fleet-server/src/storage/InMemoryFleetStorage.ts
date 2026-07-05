/**
 * @file InMemoryFleetStorage.ts
 * In-process `IFleetStorage` implementation. Suitable for a single-instance
 * Mission Control deployment; a durable backend (Postgres, Redis, SQLite —
 * matching the storage-swap pattern already established by
 * `@a2amesh/runtime`'s `ITaskStorage`) can implement the same interface
 * without touching `FleetControlPlaneServer`.
 */

import type {
  FleetAuditEntry,
  FleetAuditListFilter,
  FleetRunListFilter,
  FleetRunPatch,
  FleetRunRecord,
  IFleetStorage,
} from './IFleetStorage.js';
import type { FleetArtifactRecord } from '@a2amesh/internal-fleet';

export class InMemoryFleetStorage implements IFleetStorage {
  private readonly runs = new Map<string, FleetRunRecord>();
  private readonly audit: FleetAuditEntry[] = [];
  private nextSequence = 0;

  async createRun(run: FleetRunRecord): Promise<FleetRunRecord> {
    const stored = { ...run };
    this.runs.set(run.id, stored);
    return { ...stored };
  }

  async getRun(id: string): Promise<FleetRunRecord | null> {
    const run = this.runs.get(id);
    return run ? { ...run } : null;
  }

  async listRuns(filter: FleetRunListFilter = {}): Promise<FleetRunRecord[]> {
    return [...this.runs.values()]
      .filter((run) => (filter.status ? run.status === filter.status : true))
      .filter((run) => (filter.approvalState ? run.approvalState === filter.approvalState : true))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((run) => ({ ...run }));
  }

  async updateRun(id: string, patch: FleetRunPatch): Promise<FleetRunRecord | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    const updated = { ...run, ...patch };
    this.runs.set(id, updated);
    return { ...updated };
  }

  async addArtifact(runId: string, artifact: FleetArtifactRecord): Promise<FleetRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    const updated = { ...run, artifacts: [...run.artifacts, artifact] };
    this.runs.set(runId, updated);
    return { ...updated };
  }

  async appendAudit(entry: Omit<FleetAuditEntry, 'sequence'>): Promise<FleetAuditEntry> {
    const recorded: FleetAuditEntry = { ...entry, sequence: this.nextSequence };
    this.nextSequence += 1;
    this.audit.push(recorded);
    return { ...recorded };
  }

  async listAudit(filter: FleetAuditListFilter = {}): Promise<FleetAuditEntry[]> {
    const filtered = filter.runId
      ? this.audit.filter((entry) => entry.runId === filter.runId)
      : this.audit;
    const ordered = [...filtered].sort((left, right) => left.sequence - right.sequence);
    return (filter.limit ? ordered.slice(-filter.limit) : ordered).map((entry) => ({ ...entry }));
  }
}
