import type { AgentCard, TaskStatus, ExtensibleArtifact } from '@a2amesh/protocol';

/**
 * WorkerCard extends the core AgentCard to represent a worker node
 * in the Fleet orchestration system.
 */
export interface WorkerCard extends AgentCard {
  /** Fleet-specific roles this worker can fulfill */
  fleetRoles?: string[];
  /** Maximum number of concurrent tasks this worker can handle */
  maxConcurrentTasks?: number;
}

/**
 * FleetWorker represents an active worker node in the Fleet.
 */
export type FleetWorkerStatus = 'IDLE' | 'BUSY' | 'OFFLINE';

export type FleetRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

export type FleetStrategyType = 'MANUAL' | 'ROUND_ROBIN' | 'CAPABILITY_MATCH';

export interface FleetWorker {
  id: string;
  card: WorkerCard;
  status: FleetWorkerStatus;
  lastSeenAt: string;
  labels?: Record<string, string>;
}

/**
 * Strategy definitions for task assignment and execution.
 */
export interface FleetStrategy {
  type: FleetStrategyType;
  fallbackStrategy?: FleetStrategy;
  parameters?: Record<string, unknown>;
}

/**
 * FleetTask extends the concept of a task for distributed execution.
 */
export interface FleetTask {
  id: string;
  description?: string;
  requiredCapabilities?: string[];
  strategy?: FleetStrategy;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  targetWorkerId?: string;
}

/**
 * FleetRun represents an execution of a FleetTask on a FleetWorker.
 */
export interface FleetRun {
  id: string;
  taskId: string;
  workerId: string;
  status: FleetRunStatus;
  startedAt?: string;
  completedAt?: string;
  artifacts?: ExtensibleArtifact[];
  metrics?: Record<string, unknown>;
}

export type FleetControlPlaneResponsibility =
  | 'worker-discovery'
  | 'capability-indexing'
  | 'routing-decision'
  | 'run-admission'
  | 'failure-classification'
  | 'human-handoff'
  | 'artifact-routing';

export type FleetRoutingSignal =
  | 'capability'
  | 'role'
  | 'tenant'
  | 'policy'
  | 'availability'
  | 'load'
  | 'affinity'
  | 'cost'
  | 'latency';

export type FleetFailureClass =
  | 'WORKER_UNAVAILABLE'
  | 'CAPABILITY_MISMATCH'
  | 'POLICY_DENIED'
  | 'TIMEOUT'
  | 'ARTIFACT_REJECTED'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'UNKNOWN';

export type FleetRecoveryAction =
  | 'RETRY_SAME_WORKER'
  | 'ROUTE_TO_ALTERNATE_WORKER'
  | 'QUEUE_FOR_CAPACITY'
  | 'REQUEST_HUMAN_APPROVAL'
  | 'FAIL_CLOSED'
  | 'OPEN_INCIDENT';

export interface FleetWorkerDiscoveryRecord {
  workerId: string;
  card: WorkerCard;
  discoveredAt: string;
  lastHeartbeatAt: string;
  status: FleetWorkerStatus;
  capabilities: readonly string[];
  roles: readonly string[];
  tenants?: readonly string[];
  labels?: Record<string, string>;
}

export interface FleetRoutingPolicy {
  strategy: FleetStrategy;
  requiredSignals: readonly FleetRoutingSignal[];
  fallback?: FleetRecoveryAction;
  maxCandidateWorkers?: number;
  tenantScoped?: boolean;
  requiresHumanApproval?: boolean;
}

export interface FleetRoutingDecision {
  taskId: string;
  selectedWorkerId?: string;
  candidateWorkerIds: readonly string[];
  signals: readonly FleetRoutingSignal[];
  policy: FleetRoutingPolicy;
  reason: string;
  decidedAt: string;
}

export interface FleetFailureHandlingPlan {
  failureClass: FleetFailureClass;
  action: FleetRecoveryAction;
  retryable: boolean;
  maxAttempts?: number;
  humanHandoffReason?: string;
}

export interface FleetControlPlaneContract {
  version: 'post-1.0';
  responsibilities: readonly FleetControlPlaneResponsibility[];
  routingPolicy: FleetRoutingPolicy;
  failureHandling: readonly FleetFailureHandlingPlan[];
  discoveryTtlSeconds: number;
}

export type FleetSideEffectLevel = 'read-only' | 'local-write' | 'remote-write' | 'publish' | 'deploy';

export type FleetApprovalState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export type FleetSandboxIsolation = 'none' | 'process' | 'container' | 'vm' | 'remote-runner';

export type FleetArtifactSensitivity = 'public' | 'internal' | 'confidential' | 'restricted';

export interface FleetSandboxProfile {
  isolation: FleetSandboxIsolation;
  network: 'disabled' | 'allowlisted' | 'egress-proxy';
  filesystem: 'read-only' | 'workspace-write' | 'ephemeral-write';
  maxRuntimeSeconds?: number;
  allowedHosts?: readonly string[];
  allowedCommands?: readonly string[];
  blockedCommands?: readonly string[];
}

export interface FleetArtifactPolicy {
  sensitivity: FleetArtifactSensitivity;
  allowedArtifactTypes: readonly string[];
  maxArtifactBytes?: number;
  requireChecksum: boolean;
  requireRedaction: boolean;
  retentionDays?: number;
}

export interface FleetApprovalGate {
  requiredFor: readonly FleetSideEffectLevel[];
  state: FleetApprovalState;
  approver?: string;
  reason?: string;
  expiresAt?: string;
}

export interface FleetPolicyDecision {
  allowed: boolean;
  sideEffectLevel: FleetSideEffectLevel;
  sandbox: FleetSandboxProfile;
  artifactPolicy: FleetArtifactPolicy;
  approval: FleetApprovalGate;
  denialReason?: string;
  evidence: readonly string[];
}

export interface FleetSideEffectBoundary {
  level: FleetSideEffectLevel;
  requiresApproval: boolean;
  requiresAudit: boolean;
  permittedCommands?: readonly string[];
  forbiddenTargets?: readonly string[];
}

export interface FleetWorkerRunAdmission {
  taskId: string;
  workerId: string;
  decision: FleetPolicyDecision;
  boundaries: readonly FleetSideEffectBoundary[];
  admittedAt?: string;
}
