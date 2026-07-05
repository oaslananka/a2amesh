import type {
  FleetArtifactRecord,
  FleetAuditEntry,
  FleetRun,
  FleetWorkerSummary,
} from '../api/fleet';

export const reviewerWorker: FleetWorkerSummary = {
  workerId: 'worker-1',
  name: 'Reviewer Worker',
  status: 'IDLE',
  capabilities: ['code-review'],
  roles: ['reviewer'],
  lastHeartbeatAt: '2026-07-05T00:00:00.000Z',
  activeRunCount: 0,
  maxConcurrentTasks: 2,
};

export const runningRun: FleetRun = {
  id: 'run-1',
  taskId: 'task-1',
  workerId: 'worker-1',
  status: 'RUNNING',
  approvalState: 'NOT_REQUIRED',
  routingDecision: {
    taskId: 'task-1',
    selectedWorkerId: 'worker-1',
    candidateWorkerIds: ['worker-1'],
    signals: ['capability'],
    reason: 'selected by capability match',
    decidedAt: '2026-07-05T00:00:00.000Z',
  },
  artifacts: [],
  createdAt: '2026-07-05T00:00:00.000Z',
  updatedAt: '2026-07-05T00:00:00.000Z',
};

export const pendingRun: FleetRun = {
  ...runningRun,
  id: 'run-2',
  taskId: 'task-2',
  status: 'PENDING',
  approvalState: 'PENDING',
  riskLevel: 'publish',
};

export const planArtifact: FleetArtifactRecord = {
  artifactId: 'artifact-1',
  kind: 'plan',
  taskId: 'task-1',
  contentType: 'text/markdown',
  sensitivity: 'internal',
  redacted: false,
  provenance: { producerId: 'worker-1', taskId: 'task-1' },
  createdAt: '2026-07-05T00:00:00.000Z',
  content: 'Plan: review the diff.',
};

export const auditEntries: FleetAuditEntry[] = [
  { sequence: 0, timestamp: '2026-07-05T00:00:00.000Z', action: 'task-routed', runId: 'run-1' },
  { sequence: 1, timestamp: '2026-07-05T00:01:00.000Z', action: 'run-completed', runId: 'run-1' },
];
