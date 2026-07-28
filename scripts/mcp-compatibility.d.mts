export type McpNextDecision =
  | 'adopt-after-final-gate'
  | 'defer'
  | 'evaluate'
  | 'isolate'
  | 'reject'
  | 'retain';

export interface McpNextSurface {
  id: string;
  current: string;
  next: string;
  decision: McpNextDecision;
  evidence: string;
  rollback: string;
}

export interface McpNextProbeRequestEvidence {
  protocolVersion?: string;
  methodHeader?: string;
  nameHeader?: string;
  method?: string;
  name?: string;
  hasCredential?: boolean;
}

export interface McpNextProbePayload {
  sdk?: {
    client?: string;
    core?: string;
    node?: string;
    server?: string;
  };
  protocolVersion?: string;
  unauthorizedStatus?: number;
  methods?: string[];
  sawInitialize?: boolean;
  tools?: {
    names?: string[];
    ttlMs?: number;
    cacheScope?: string;
  };
  call?: { text?: string };
  requests?: McpNextProbeRequestEvidence[];
}

export interface McpNextFixtureMap {
  'legacy-initialize-request': { method: string };
  'discover-request': {
    method: string;
    params: {
      _meta: Record<string, unknown>;
    };
  };
  'discover-result': Record<string, unknown>;
  'tools-list-result': {
    ttlMs: number;
    cacheScope: string;
    tools: Array<{ name: string }>;
  };
  'tool-call-request': {
    headers: Record<string, string>;
    body: {
      method: string;
      params: {
        name: string;
        arguments: Record<string, unknown>;
        _meta: Record<string, unknown>;
      };
    };
  };
  'tool-call-result': Record<string, unknown>;
  'unsupported-version-error': {
    error: {
      code: number;
      data: {
        requested: string;
        supported: string[];
      };
    };
  };
  'cancelled-notification': { method: string };
  'auth-denied': { status: number };
  'sdk-v2-probe-result': McpNextProbePayload;
}

export interface McpNextContract {
  protocolVersion: string;
  supportStatus: string;
  stableSdkRange: string;
  candidateSdk: {
    client: string;
    core: string;
    node: string;
    server: string;
  };
  surfaces: McpNextSurface[];
  fixtures: McpNextFixtureMap;
}

export interface McpNextProbeReport {
  status: 'compatible' | 'incompatible';
  exitCode: number;
  summary: string;
}

export function loadMcpNextContract(root?: string): McpNextContract;
export function validateMcpNextContract(contract: McpNextContract): string[];
export function validateMcpNextProbePayload(payload: McpNextProbePayload): string[];
export function evaluateMcpNextProbeResult(input: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): McpNextProbeReport;
