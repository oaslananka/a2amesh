/**
 * @file InMemoryFleetStorage.ts
 * In-process `IFleetStorage` implementation.
 */

import type { FleetArtifactRecord } from '@a2amesh/internal-fleet';
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
      .filter((run) => matchesTenant(run.tenantId, filter.tenantId))
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

  async transitionRun(
    id: string,
    expected: FleetRunTransitionCondition,
    patch: FleetRunPatch,
  ): Promise<FleetRunTransitionResult> {
    const run = this.runs.get(id);
    if (!run) return { outcome: 'not-found' };
    if (!matchesExpectedState(run, expected)) {
      return matchesTargetState(run, patch)
        ? { outcome: 'unchanged', run: { ...run } }
        : { outcome: 'conflict', run: { ...run } };
    }
    const updated = { ...run, ...patch };
    this.runs.set(id, updated);
    return { outcome: 'updated', run: { ...updated } };
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
    const filtered = this.audit
      .filter((entry) => (filter.runId ? entry.runId === filter.runId : true))
      .filter((entry) => matchesTenant(entry.tenantId, filter.tenantId));
    const ordered = [...filtered].sort((left, right) => left.sequence - right.sequence);
    return (filter.limit ? ordered.slice(-filter.limit) : ordered).map((entry) => ({ ...entry }));
  }
}

function matchesTargetState(run: FleetRunRecord, patch: FleetRunPatch): boolean {
  const hasTargetState = patch.status !== undefined || patch.approvalState !== undefined;
  return (
    hasTargetState &&
    (patch.status === undefined || run.status === patch.status) &&
    (patch.approvalState === undefined || run.approvalState === patch.approvalState)
  );
}

function matchesExpectedState(run: FleetRunRecord, expected: FleetRunTransitionCondition): boolean {
  return (
    (expected.status === undefined || run.status === expected.status) &&
    (expected.approvalState === undefined || run.approvalState === expected.approvalState)
  );
}

function matchesTenant(
  actualTenantId: string | undefined,
  requestedTenantId: string | null | undefined,
): boolean {
  if (requestedTenantId === undefined) return true;
  if (requestedTenantId === null) return actualTenantId === undefined;
  return actualTenantId === requestedTenantId;
}
