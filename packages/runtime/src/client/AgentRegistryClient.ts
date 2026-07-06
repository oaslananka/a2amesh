/**
 * @file AgentRegistryClient.ts
 * Client for the local registry REST/SSE endpoints.
 */

import { EventSource, type EventSourceInit } from 'eventsource';
import type { RegistryExportDocument } from '../schemas/public.js';
import type { AgentCard } from '../types/agent-card.js';
import { createEventSourceReader } from './eventSourceReader.js';

export interface RegisteredAgent {
  id: string;
  url: string;
  card: AgentCard;
  status: 'healthy' | 'unhealthy' | 'unknown';
  tags: string[];
  skills: string[];
  registeredAt: string;
  lastHeartbeatAt?: string;
  consecutiveFailures?: number;
  lastSuccessAt?: string;
  tenantId?: string;
  isPublic?: boolean;
}

export interface RegisterAgentOptions {
  tenantId?: string;
  isPublic?: boolean;
}

export interface RegistryImportResult {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
}

export interface TrustLogEntry {
  sequence: number;
  cardHash: string;
  keyId: string;
  algorithm: string;
  agentUrl: string;
  tenantId?: string;
  timestamp: string;
  entryHash: string;
}

export interface TrustLogQuery {
  cardHash?: string;
  limit?: number;
}

/**
 * Client for the registry REST and SSE endpoints.
 *
 * @example
 * ```ts
 * const registry = new AgentRegistryClient('http://localhost:3099');
 * const agents = await registry.listAgents();
 * ```
 * @since 1.0.0
 */
export class AgentRegistryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async register(
    agentUrl: string,
    agentCard: AgentCard,
    options: RegisterAgentOptions = {},
  ): Promise<RegisteredAgent> {
    const response = await this.fetchImplementation(new URL('/agents/register', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentUrl, agentCard, ...options }),
    });
    if (!response.ok) {
      throw new Error(`Failed to register agent (${response.status})`);
    }
    return (await response.json()) as RegisteredAgent;
  }

  async listAgents(): Promise<RegisteredAgent[]> {
    const response = await this.fetchImplementation(new URL('/agents', this.baseUrl));
    if (!response.ok) {
      throw new Error(`Failed to list agents (${response.status})`);
    }
    return (await response.json()) as RegisteredAgent[];
  }

  async exportAgents(): Promise<RegistryExportDocument> {
    const response = await this.fetchImplementation(new URL('/admin/agents/export', this.baseUrl));
    if (!response.ok) {
      throw new Error(`Failed to export agents (${response.status})`);
    }
    return (await response.json()) as RegistryExportDocument;
  }

  async importAgents(document: RegistryExportDocument): Promise<RegistryImportResult> {
    const response = await this.fetchImplementation(new URL('/admin/agents/import', this.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (!response.ok) {
      throw new Error(`Failed to import agents (${response.status})`);
    }
    return (await response.json()) as RegistryImportResult;
  }

  async getAgent(id: string): Promise<RegisteredAgent> {
    const response = await this.fetchImplementation(new URL(`/agents/${id}`, this.baseUrl));
    if (!response.ok) {
      throw new Error(`Failed to fetch agent (${response.status})`);
    }
    return (await response.json()) as RegisteredAgent;
  }

  async searchAgents(
    query: string,
    filters: Record<string, string> = {},
  ): Promise<RegisteredAgent[]> {
    const url = new URL('/agents/search', this.baseUrl);
    url.searchParams.set('skill', query);
    for (const [key, value] of Object.entries(filters)) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchImplementation(url);
    if (!response.ok) {
      throw new Error(`Failed to search agents (${response.status})`);
    }
    return (await response.json()) as RegisteredAgent[];
  }

  async sendHeartbeat(id: string): Promise<RegisteredAgent> {
    const response = await this.fetchImplementation(
      new URL(`/agents/${id}/heartbeat`, this.baseUrl),
      {
        method: 'POST',
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to send heartbeat (${response.status})`);
    }
    return (await response.json()) as RegisteredAgent;
  }

  async health(): Promise<Record<string, unknown>> {
    const response = await this.fetchImplementation(new URL('/health', this.baseUrl));
    if (!response.ok) {
      throw new Error(`Failed to fetch registry health (${response.status})`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  async getTrustLog(query: TrustLogQuery = {}): Promise<TrustLogEntry[]> {
    const url = query.cardHash
      ? new URL(`/trust-log/${query.cardHash}`, this.baseUrl)
      : new URL('/trust-log', this.baseUrl);
    if (query.limit !== undefined) {
      url.searchParams.set('limit', String(query.limit));
    }
    const response = await this.fetchImplementation(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch trust log (${response.status})`);
    }
    return (await response.json()) as TrustLogEntry[];
  }

  async *events(): AsyncGenerator<unknown> {
    const source = new EventSource(
      new URL('/events', this.baseUrl).toString(),
      this.createEventSourceInit(),
    );

    yield* createEventSourceReader<unknown>(source, 'registry_update');
  }

  private createEventSourceInit(): EventSourceInit | undefined {
    if (this.fetchImplementation === fetch) {
      return undefined;
    }

    return {
      fetch: (input, init) => this.fetchImplementation(input, init),
    };
  }
}
