import type { AgentCard } from '@a2amesh/runtime';
import type { AgentListQuery, AgentListResult, AgentStorageSummary } from './indexing.js';

export type AgentStatus = 'healthy' | 'unhealthy' | 'unknown';
export type AgentTrustState = 'trusted' | 'unverified' | 'rejected';

export interface AgentCardVerificationMetadata {
  required: boolean;
  valid: boolean;
  state: AgentTrustState;
  verifiedAt: string;
  keyId?: string | undefined;
  tenantId?: string | undefined;
  failureReason?: string | undefined;
}

export interface RegisteredAgent {
  id: string;
  url: string;
  card: AgentCard;
  status: AgentStatus;
  tags: string[];
  skills: string[];
  registeredAt: string;
  lastHeartbeatAt?: string;
  /** Number of consecutive health check failures */
  consecutiveFailures?: number;
  /** Last time the agent passed a health check */
  lastSuccessAt?: string;
  /** The tenant or namespace this agent belongs to */
  tenantId?: string;
  /** If true, the agent can be discovered by other tenants */
  isPublic?: boolean;
  /** Signed Agent Card verification and trust lifecycle metadata. */
  verification?: AgentCardVerificationMetadata;
}

export interface IAgentStorage {
  upsert(agent: RegisteredAgent): Promise<RegisteredAgent>;
  get(id: string): Promise<RegisteredAgent | null>;
  getAll(): Promise<RegisteredAgent[]>;
  list(query?: AgentListQuery): Promise<AgentListResult>;
  summarize(
    query?: Pick<AgentListQuery, 'tenantId' | 'includePublic' | 'isPublic'>,
  ): Promise<AgentStorageSummary>;
  delete(id: string): Promise<boolean>;
  updateStatus(
    id: string,
    status: AgentStatus,
    meta?: { consecutiveFailures?: number; lastSuccessAt?: string },
  ): Promise<void>;
  findBySkill(skill: string): Promise<RegisteredAgent[]>;
}
