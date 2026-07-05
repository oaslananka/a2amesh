/**
 * @file IFleetStorage.ts
 * Storage contract for the Fleet control plane: runs (the dispatch/approval
 * unit Mission Control tracks) and an append-only audit timeline.
 */

import type {
  FleetApprovalState,
  FleetArtifactRecord,
  FleetRoutingDecision,
  FleetRunStatus,
  FleetSideEffectLevel,
} from '@a2amesh/internal-fleet';

export interface FleetRunRecord {
  id: string;
  taskId: string;
  /** The worker `routeFleetTask` selected, or proposed for a run still pending approval. */
  workerId: string;
  status: FleetRunStatus;
  approvalState: FleetApprovalState;
  riskLevel?: FleetSideEffectLevel;
  routingDecision: FleetRoutingDecision;
  artifacts: FleetArtifactRecord[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export type FleetRunPatch = Partial<
  Pick<
    FleetRunRecord,
    'status' | 'approvalState' | 'completedAt' | 'failureReason' | 'updatedAt' | 'workerId'
  >
>;

export type FleetAuditAction =
  | 'task-routed'
  | 'run-pending-approval'
  | 'run-approved'
  | 'run-rejected'
  | 'run-completed'
  | 'run-failed'
  | 'artifact-added';

export interface FleetAuditEntry {
  sequence: number;
  timestamp: string;
  action: FleetAuditAction;
  runId?: string;
  taskId?: string;
  actor?: string;
  detail?: Record<string, unknown>;
}

export interface FleetRunListFilter {
  status?: FleetRunStatus;
  approvalState?: FleetApprovalState;
}

export interface FleetAuditListFilter {
  runId?: string;
  limit?: number;
}

export interface IFleetStorage {
  createRun(run: FleetRunRecord): Promise<FleetRunRecord>;
  getRun(id: string): Promise<FleetRunRecord | null>;
  listRuns(filter?: FleetRunListFilter): Promise<FleetRunRecord[]>;
  updateRun(id: string, patch: FleetRunPatch): Promise<FleetRunRecord | null>;
  addArtifact(runId: string, artifact: FleetArtifactRecord): Promise<FleetRunRecord | null>;
  appendAudit(entry: Omit<FleetAuditEntry, 'sequence'>): Promise<FleetAuditEntry>;
  listAudit(filter?: FleetAuditListFilter): Promise<FleetAuditEntry[]>;
}
