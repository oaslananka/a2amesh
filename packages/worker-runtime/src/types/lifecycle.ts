import type { ExtensibleArtifact, TaskStatus } from '@a2amesh/protocol';
import type {
  FleetRun,
  FleetRunStatus,
  FleetTask,
  FleetWorker,
  WorkerCard,
} from '@a2amesh/internal-fleet';

export type WorkerRuntimeOperation =
  | 'prepare'
  | 'start'
  | 'stream'
  | 'observe'
  | 'verify'
  | 'finalize'
  | 'cancel'
  | 'cleanup';

export type WorkerRuntimeFailureCode =
  | 'TIMEOUT'
  | 'CANCELED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'WORKER_UNAVAILABLE'
  | 'ARTIFACT_UNAVAILABLE'
  | 'VERIFICATION_FAILED'
  | 'UNKNOWN';

export type WorkerRuntimeEventType =
  | 'prepared'
  | 'started'
  | 'task-update'
  | 'artifact'
  | 'usage'
  | 'verification'
  | 'finalized'
  | 'canceled'
  | 'cleaned-up'
  | 'failed';

export interface WorkerRuntimeFailure {
  code: WorkerRuntimeFailureCode;
  message: string;
  operation?: WorkerRuntimeOperation;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface WorkerRuntimeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  elapsedMs?: number;
  billableUnits?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeCost {
  currency?: string;
  amount?: number;
  costClass?: 'FREE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeVerificationResult {
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  verifierWorkerId?: string;
  checkedAt: string;
  summary?: string;
  failures?: WorkerRuntimeFailure[];
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeContext {
  task: FleetTask;
  worker: FleetWorker;
  run: FleetRun;
  card?: WorkerCard;
  timeoutMs?: number;
  deadlineAt?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeEvent {
  type: WorkerRuntimeEventType;
  runId: string;
  workerId: string;
  taskId: string;
  timestamp: string;
  status?: FleetRunStatus;
  taskStatus?: TaskStatus;
  artifact?: ExtensibleArtifact;
  usage?: WorkerRuntimeUsage;
  cost?: WorkerRuntimeCost;
  verification?: WorkerRuntimeVerificationResult;
  failure?: WorkerRuntimeFailure;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeResult {
  status: FleetRunStatus;
  taskStatus?: TaskStatus;
  artifacts?: ExtensibleArtifact[];
  usage?: WorkerRuntimeUsage;
  cost?: WorkerRuntimeCost;
  verification?: WorkerRuntimeVerificationResult;
  failure?: WorkerRuntimeFailure;
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeStopRequest {
  reason?: string;
  requestedAt: string;
  requestedBy?: 'operator' | 'scheduler' | 'timeout' | 'policy' | 'worker';
  metadata?: Record<string, unknown>;
}

export interface WorkerRuntimeContract {
  readonly id: string;
  readonly card: WorkerCard;

  prepare(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent>;
  start(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent>;
  stream(context: WorkerRuntimeContext): AsyncIterable<WorkerRuntimeEvent>;
  observe(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent>;
  verify(context: WorkerRuntimeContext): Promise<WorkerRuntimeVerificationResult>;
  finalize(
    context: WorkerRuntimeContext,
    result: WorkerRuntimeResult,
  ): Promise<WorkerRuntimeResult>;
  cancel(
    context: WorkerRuntimeContext,
    request: WorkerRuntimeStopRequest,
  ): Promise<WorkerRuntimeEvent>;
  cleanup(context: WorkerRuntimeContext): Promise<WorkerRuntimeEvent>;
}
