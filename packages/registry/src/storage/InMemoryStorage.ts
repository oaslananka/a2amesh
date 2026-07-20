import { AgentStorageBase } from './AgentStorageBase.js';
import type { AgentStatus, RegisteredAgent } from './IAgentStorage.js';
import {
  buildAgentIndexTerms,
  type AgentListQuery,
  type AgentListResult,
  termMatchesQuery,
  matchesVisibility,
  paginateAgents,
  sortAgentsByRegistration,
} from './indexing.js';

export class InMemoryStorage extends AgentStorageBase {
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly statusIndex = new Map<AgentStatus, Set<string>>([
    ['healthy', new Set()],
    ['unhealthy', new Set()],
    ['unknown', new Set()],
  ]);
  private readonly tenantIndex = new Map<string, Set<string>>();
  private readonly publicIndex = new Set<string>();
  private readonly skillIndex = new Map<string, Set<string>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly nameIndex = new Map<string, Set<string>>();
  private readonly transportIndex = new Map<string, Set<string>>();
  private readonly mcpCompatibleIndex = new Set<string>();

  async upsert(agent: RegisteredAgent): Promise<RegisteredAgent> {
    const previous = this.agents.get(agent.id);
    if (previous) {
      this.removeFromIndexes(previous);
    }

    this.agents.set(agent.id, agent);
    this.addToIndexes(agent);
    return agent;
  }

  async get(id: string): Promise<RegisteredAgent | null> {
    return this.agents.get(id) ?? null;
  }

  async getAll(): Promise<RegisteredAgent[]> {
    return sortAgentsByRegistration(Array.from(this.agents.values()));
  }

  async list(query: AgentListQuery = {}): Promise<AgentListResult> {
    const candidateIds = this.findCandidateIds(query);
    const agents = Array.from(candidateIds)
      .map((id) => this.agents.get(id))
      .filter((agent): agent is RegisteredAgent => agent !== undefined)
      .filter((agent) => this.matchesAgent(agent, query));
    return paginateAgents(agents, query);
  }

  async delete(id: string): Promise<boolean> {
    const current = this.agents.get(id);
    if (!current) {
      return false;
    }

    this.removeFromIndexes(current);
    return this.agents.delete(id);
  }

  private addToIndexes(agent: RegisteredAgent): void {
    const terms = buildAgentIndexTerms(agent);
    this.statusIndex.get(terms.status)?.add(agent.id);
    if (terms.tenantId) {
      this.addIndexValue(this.tenantIndex, terms.tenantId, agent.id);
    }
    if (terms.isPublic) {
      this.publicIndex.add(agent.id);
    }
    terms.skills.forEach((term) => this.addIndexValue(this.skillIndex, term, agent.id));
    terms.tags.forEach((term) => this.addIndexValue(this.tagIndex, term, agent.id));
    terms.names.forEach((term) => this.addIndexValue(this.nameIndex, term, agent.id));
    this.addIndexValue(this.transportIndex, terms.transport, agent.id);
    if (terms.mcpCompatible) {
      this.mcpCompatibleIndex.add(agent.id);
    }
  }

  private removeFromIndexes(agent: RegisteredAgent): void {
    const terms = buildAgentIndexTerms(agent);
    this.statusIndex.get(terms.status)?.delete(agent.id);
    if (terms.tenantId) {
      this.removeIndexValue(this.tenantIndex, terms.tenantId, agent.id);
    }
    this.publicIndex.delete(agent.id);
    terms.skills.forEach((term) => this.removeIndexValue(this.skillIndex, term, agent.id));
    terms.tags.forEach((term) => this.removeIndexValue(this.tagIndex, term, agent.id));
    terms.names.forEach((term) => this.removeIndexValue(this.nameIndex, term, agent.id));
    this.removeIndexValue(this.transportIndex, terms.transport, agent.id);
    this.mcpCompatibleIndex.delete(agent.id);
  }

  private findCandidateIds(query: Pick<AgentListQuery, keyof AgentListQuery>): Set<string> {
    const candidateSets: Set<string>[] = [];

    if (query.isPublic === true) {
      candidateSets.push(new Set(this.publicIndex));
    } else if (query.tenantId && query.includePublic) {
      candidateSets.push(
        unionSets(this.tenantIndex.get(query.tenantId) ?? new Set(), this.publicIndex),
      );
    } else if (query.tenantId) {
      candidateSets.push(new Set(this.tenantIndex.get(query.tenantId) ?? []));
    }

    if (query.status) {
      candidateSets.push(new Set(this.statusIndex.get(query.status) ?? []));
    }

    if (query.skill) {
      candidateSets.push(this.lookupQueryTerms(this.skillIndex, query.skill));
    }

    if (query.tag) {
      candidateSets.push(this.lookupQueryTerms(this.tagIndex, query.tag));
    }

    if (query.name) {
      candidateSets.push(this.lookupQueryTerms(this.nameIndex, query.name));
    }

    if (query.transport) {
      candidateSets.push(new Set(this.transportIndex.get(query.transport) ?? []));
    }

    if (query.mcpCompatible === true) {
      candidateSets.push(new Set(this.mcpCompatibleIndex));
    }
    if (query.mcpCompatible === false) {
      candidateSets.push(
        new Set(Array.from(this.agents.keys()).filter((id) => !this.mcpCompatibleIndex.has(id))),
      );
    }

    if (candidateSets.length === 0) {
      return new Set(this.agents.keys());
    }

    return intersectSets(candidateSets);
  }

  private lookupQueryTerms(index: Map<string, Set<string>>, query: string): Set<string> {
    const normalized = query.toLowerCase();
    const matches = Array.from(index.entries())
      .filter(([term]) => termMatchesQuery(term, normalized))
      .map(([, ids]) => ids);

    return unionMany(matches);
  }

  private matchesAgent(agent: RegisteredAgent, query: AgentListQuery): boolean {
    return matchesVisibility(agent, query);
  }

  private addIndexValue(index: Map<string, Set<string>>, key: string, id: string): void {
    const values = index.get(key) ?? new Set<string>();
    values.add(id);
    index.set(key, values);
  }

  private removeIndexValue(index: Map<string, Set<string>>, key: string, id: string): void {
    const values = index.get(key);
    values?.delete(id);
    if (values?.size === 0) {
      index.delete(key);
    }
  }
}

function intersectSets(sets: Set<string>[]): Set<string> {
  const [first, ...rest] = sets.sort((left, right) => left.size - right.size);
  const result = new Set(first);

  for (const value of Array.from(result)) {
    if (!rest.every((set) => set.has(value))) {
      result.delete(value);
    }
  }

  return result;
}

function unionSets(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left, ...right]);
}

function unionMany(sets: Set<string>[]): Set<string> {
  const values = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      values.add(value);
    }
  }
  return values;
}
