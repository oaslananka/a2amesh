export type AgentStatus = 'healthy' | 'unhealthy' | 'unknown';
export type RegistryAccessMode = 'authenticated' | 'readonly-public';

interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
}

export interface RegisteredAgent {
  id: string;
  url: string;
  status: AgentStatus;
  tags?: string[];
  skills?: string[];
  tenantId?: string;
  isPublic?: boolean;
  registeredAt?: string;
  lastHeartbeatAt?: string;
  consecutiveFailures?: number;
  lastSuccessAt?: string;
  health?: {
    reason?: string;
    checkedAt?: string;
    remediationHints?: string[];
  };
  card: {
    name: string;
    description: string;
    version: string;
    transport?: 'http' | 'sse' | 'ws' | 'grpc';
    skills?: AgentSkill[];
    capabilities?: {
      streaming?: boolean;
      pushNotifications?: boolean;
      stateTransitionHistory?: boolean;
      mcpCompatible?: boolean;
      backgroundJobs?: boolean;
    };
  };
}

export interface RegistryMetrics {
  registrations: number;
  searches: number;
  heartbeats: number;
  agentCount: number;
  healthyAgents: number;
  unhealthyAgents: number;
  unknownAgents: number;
  activeTenants: number;
  publicAgents: number;
}

type TaskStatus =
  | 'SUBMITTED'
  | 'QUEUED'
  | 'WORKING'
  | 'INPUT_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'WAITING_ON_EXTERNAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'REJECTED';

export interface RegistryTaskEvent {
  taskId: string;
  agentId: string;
  agentName: string;
  agentUrl: string;
  status: TaskStatus;
  updatedAt: string;
  contextId?: string;
  summary?: string;
  historyCount: number;
  artifactCount: number;
  task: {
    id: string;
    contextId?: string;
    status: {
      state: TaskStatus;
      timestamp: string;
    };
  };
}

export type AgentStreamPayload = RegisteredAgent | { id: string; deleted: true };

export interface AgentFetchResult {
  agents: RegisteredAgent[];
  accessMode: RegistryAccessMode;
}

export class RegistryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface NewAgentCardInput {
  protocolVersion: '1.0';
  name: string;
  description: string;
  url: string;
  version: string;
}

export interface RegisterAgentInput {
  agentUrl: string;
  agentCard: NewAgentCardInput;
  tenantId?: string;
  isPublic?: boolean;
}

const BASE = (import.meta.env.VITE_REGISTRY_URL ?? '/api').replace(/\/$/, '');

function endpoint(path: string): string {
  return `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson(path: string): Promise<Response> {
  return fetch(endpoint(path), {
    credentials: 'include',
  });
}

export async function fetchAgents(): Promise<AgentFetchResult> {
  const privateResponse = await requestJson('/agents');
  if (privateResponse.ok) {
    return {
      agents: (await privateResponse.json()) as RegisteredAgent[],
      accessMode: 'authenticated',
    };
  }

  if (privateResponse.status === 401 || privateResponse.status === 403) {
    const publicResponse = await requestJson('/agents?public=true');
    if (publicResponse.ok) {
      return {
        agents: (await publicResponse.json()) as RegisteredAgent[],
        accessMode: 'readonly-public',
      };
    }
  }

  throw new RegistryApiError(`Registry error: ${privateResponse.status}`, privateResponse.status);
}

async function readProblemDetail(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { detail?: string };
    return problem.detail ?? `Registry error: ${response.status}`;
  } catch {
    return `Registry error: ${response.status}`;
  }
}

export async function registerAgent(input: RegisterAgentInput): Promise<RegisteredAgent> {
  const response = await fetch(endpoint('/agents/register'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new RegistryApiError(await readProblemDetail(response), response.status);
  }

  return (await response.json()) as RegisteredAgent;
}

export async function deleteAgent(id: string): Promise<void> {
  const response = await fetch(endpoint(`/agents/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new RegistryApiError(await readProblemDetail(response), response.status);
  }
}

export async function fetchMetrics(): Promise<RegistryMetrics> {
  const response = await requestJson('/metrics/summary');
  if (!response.ok) {
    return emptyMetrics();
  }

  return (await response.json()) as RegistryMetrics;
}

export async function fetchRecentTasks(limit = 30): Promise<RegistryTaskEvent[]> {
  const response = await requestJson(`/tasks/recent?limit=${limit}`);
  if (!response.ok) {
    throw new RegistryApiError(`Task stream error: ${response.status}`, response.status);
  }

  return (await response.json()) as RegistryTaskEvent[];
}

export function subscribeToAgentUpdates(
  onAgent: (payload: AgentStreamPayload) => void,
  onError?: (event: Event) => void,
): () => void {
  const eventSource = new EventSource(endpoint('/agents/stream'));

  eventSource.onmessage = (event) => {
    try {
      onAgent(JSON.parse(event.data) as AgentStreamPayload);
    } catch {
      // ignore malformed events
    }
  };

  if (onError) {
    eventSource.onerror = onError;
  }

  return () => eventSource.close();
}

export function subscribeToTaskStream(
  onTask: (taskEvent: RegistryTaskEvent) => void,
  onError?: (event: Event) => void,
): () => void {
  const eventSource = new EventSource(endpoint('/tasks/stream'));

  eventSource.onmessage = (event) => {
    try {
      onTask(JSON.parse(event.data) as RegistryTaskEvent);
    } catch {
      // ignore malformed events
    }
  };

  if (onError) {
    eventSource.onerror = onError;
  }

  return () => eventSource.close();
}

export function emptyMetrics(): RegistryMetrics {
  return {
    registrations: 0,
    searches: 0,
    heartbeats: 0,
    agentCount: 0,
    healthyAgents: 0,
    unhealthyAgents: 0,
    unknownAgents: 0,
    activeTenants: 0,
    publicAgents: 0,
  };
}
