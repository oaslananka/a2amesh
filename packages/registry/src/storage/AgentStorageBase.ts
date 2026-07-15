import type { AgentStatus, IAgentStorage, RegisteredAgent } from './IAgentStorage.js';
import {
  applyUpdateStatus,
  type AgentListQuery,
  type AgentListResult,
  type AgentStorageSummary,
  summarizeAgents,
} from './indexing.js';

export abstract class AgentStorageBase implements IAgentStorage {
  abstract upsert(agent: RegisteredAgent): Promise<RegisteredAgent>;
  abstract get(id: string): Promise<RegisteredAgent | null>;
  abstract getAll(): Promise<RegisteredAgent[]>;
  abstract list(query?: AgentListQuery): Promise<AgentListResult>;
  abstract delete(id: string): Promise<boolean>;

  async summarize(
    query: Pick<AgentListQuery, 'tenantId' | 'includePublic' | 'isPublic'> = {},
  ): Promise<AgentStorageSummary> {
    const agents = (await this.list({ ...query, limit: Number.MAX_SAFE_INTEGER })).items;
    return summarizeAgents(agents);
  }

  async updateStatus(
    id: string,
    status: AgentStatus,
    meta?: { consecutiveFailures?: number; lastSuccessAt?: string },
  ): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    await this.upsert(applyUpdateStatus(current, status, meta));
  }

  async findBySkill(skill: string): Promise<RegisteredAgent[]> {
    return (await this.list({ skill, limit: Number.MAX_SAFE_INTEGER })).items;
  }
}
