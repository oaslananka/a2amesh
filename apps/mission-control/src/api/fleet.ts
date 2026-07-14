type FleetWorkerStatus = 'IDLE' | 'BUSY' | 'OFFLINE';
export type FleetRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
export type FleetApprovalState = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type FleetSideEffectLevel =
  | 'read-only'
  | 'local-write'
  | 'remote-write'
  | 'publish'
  | 'deploy';

export interface FleetWorkerSummary {
  workerId: string;
  name: string;
  status: FleetWorkerStatus;
  capabilities: readonly string[];
  roles: readonly string[];
  tenants?: readonly string[];
  lastHeartbeatAt: string;
  activeRunCount: number;
  maxConcurrentTasks?: number;
}

interface FleetRoutingDecision {
  taskId: string;
  selectedWorkerId?: string;
  candidateWorkerIds: readonly string[];
  signals: readonly string[];
  reason: string;
  decidedAt: string;
}

export interface FleetArtifactRecord {
  artifactId: string;
  kind: string;
  taskId: string;
  contentType: string;
  sensitivity: string;
  redacted: boolean;
  provenance: { producerId: string; taskId: string; runId?: string };
  createdAt: string;
  content?: string;
  payloadRef?: string;
  sizeBytes?: number;
  checksumSha256?: string;
}

export interface FleetRun {
  id: string;
  taskId: string;
  workerId: string;
  status: FleetRunStatus;
  approvalState: FleetApprovalState;
  riskLevel?: FleetSideEffectLevel;
  tenantId?: string;
  requestedByPrincipalId?: string;
  routingDecision: FleetRoutingDecision;
  artifacts: FleetArtifactRecord[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
}

type FleetAuditAction =
  | 'task-routed'
  | 'run-pending-approval'
  | 'run-approved'
  | 'run-rejected'
  | 'run-completed'
  | 'run-failed'
  | 'run-canceled'
  | 'artifact-added';

export interface FleetAuditEntry {
  sequence: number;
  timestamp: string;
  action: FleetAuditAction;
  runId?: string;
  taskId?: string;
  actor?: string;
  tenantId?: string;
  detail?: Record<string, unknown>;
}

export interface RouteTaskRequest {
  taskId: string;
  requiredCapabilities?: string[];
  workspaceScope?: string;
  riskLevel?: FleetSideEffectLevel;
  requiresApproval?: boolean;
  tenantId?: string;
}

export interface RouteTaskResult {
  decision: FleetRoutingDecision;
  run: FleetRun | null;
}

class FleetApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_FLEET_URL ?? '/api').replace(/\/$/, '');

function endpoint(path: string): string {
  return `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new FleetApiError(
      body?.error?.message ?? `Fleet API error: ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export async function fetchWorkers(): Promise<FleetWorkerSummary[]> {
  return requestJson('/fleet/workers');
}

export async function fetchRuns(
  filter: {
    status?: FleetRunStatus;
    approvalState?: FleetApprovalState;
  } = {},
): Promise<FleetRun[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.approvalState) params.set('approvalState', filter.approvalState);
  const query = params.toString();
  return requestJson(`/fleet/runs${query ? `?${query}` : ''}`);
}

export async function fetchRunArtifacts(id: string): Promise<FleetArtifactRecord[]> {
  return requestJson(`/fleet/runs/${id}/artifacts`);
}

export async function fetchAudit(
  filter: { runId?: string; limit?: number } = {},
): Promise<FleetAuditEntry[]> {
  const params = new URLSearchParams();
  if (filter.runId) params.set('runId', filter.runId);
  if (filter.limit) params.set('limit', String(filter.limit));
  const query = params.toString();
  return requestJson(`/fleet/audit${query ? `?${query}` : ''}`);
}

export async function routeTask(request: RouteTaskRequest): Promise<RouteTaskResult> {
  return requestJson('/fleet/tasks/route', { method: 'POST', body: JSON.stringify(request) });
}

export async function approveRun(id: string): Promise<FleetRun> {
  return requestJson(`/fleet/runs/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function rejectRun(id: string, reason?: string): Promise<FleetRun> {
  return requestJson(`/fleet/runs/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

export function subscribeToFleetEvents(
  onRunUpdated: (run: FleetRun) => void,
  onError?: (event: Event) => void,
): () => void {
  const eventSource = new EventSource(endpoint('/fleet/events'));

  eventSource.addEventListener('run-updated', (event: MessageEvent<string>) => {
    try {
      onRunUpdated(JSON.parse(event.data) as FleetRun);
    } catch {
      // ignore malformed events
    }
  });

  if (onError) {
    eventSource.onerror = onError;
  }

  return () => eventSource.close();
}
