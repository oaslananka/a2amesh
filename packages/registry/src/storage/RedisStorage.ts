import { AgentStorageBase } from './AgentStorageBase.js';
import type { RegisteredAgent } from './IAgentStorage.js';
import {
  buildAgentIndexTerms,
  type AgentListQuery,
  type AgentListResult,
  termMatchesQuery,
  matchesVisibility,
  paginateAgents,
} from './indexing.js';

export interface RegistryRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  sadd?(key: string, ...members: string[]): Promise<number>;
  srem?(key: string, ...members: string[]): Promise<number>;
  smembers?(key: string): Promise<string[]>;
  sAdd?(key: string, members: string | string[]): Promise<number>;
  sRem?(key: string, members: string | string[]): Promise<number>;
  sMembers?(key: string): Promise<string[]>;
  SADD?(key: string, ...members: string[]): Promise<number>;
  SREM?(key: string, ...members: string[]): Promise<number>;
  SMEMBERS?(key: string): Promise<string[]>;
  multi?(): RegistryRedisTransaction;
  scan?(
    cursor: string | number,
    matchOption: 'MATCH',
    pattern: string,
    countOption?: 'COUNT',
    count?: number,
  ): Promise<[string, string[]]>;
  keys?(pattern: string): Promise<string[]>;
}

export interface RegistryPollingLeaseRecord {
  scope: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface RegistryDistributedPollingLeaseStore {
  acquirePollingLease(scope: string, ownerId: string, ttlMs: number): Promise<boolean>;
  releasePollingLease(scope: string, ownerId: string): Promise<void>;
  getPollingLease(scope: string): Promise<RegistryPollingLeaseRecord | null>;
}

export interface RegistryRedisTransaction {
  set?(key: string, value: string): RegistryRedisTransaction;
  del?(key: string): RegistryRedisTransaction;
  sadd?(key: string, ...members: string[]): RegistryRedisTransaction;
  srem?(key: string, ...members: string[]): RegistryRedisTransaction;
  sAdd?(key: string, members: string | string[]): RegistryRedisTransaction;
  sRem?(key: string, members: string | string[]): RegistryRedisTransaction;
  SADD?(key: string, ...members: string[]): RegistryRedisTransaction;
  SREM?(key: string, ...members: string[]): RegistryRedisTransaction;
  exec(): Promise<unknown>;
}

interface RedisSetCommands {
  add(key: string, ...members: string[]): Promise<unknown>;
  remove(key: string, ...members: string[]): Promise<unknown>;
  members(key: string): Promise<string[]>;
}

interface RedisMutationBatch {
  transaction: RegistryRedisTransaction | null;
  queued: boolean;
}

export class RedisStorage extends AgentStorageBase {
  private readonly setCommands: RedisSetCommands | null;

  constructor(
    private readonly client: RegistryRedisClient,
    private readonly prefix = 'a2a:registry',
  ) {
    super();
    this.setCommands = resolveSetCommands(client);
  }

  async upsert(agent: RegisteredAgent): Promise<RegisteredAgent> {
    const previous = await this.get(agent.id);

    if (this.setCommands) {
      const batch = this.createMutationBatch();
      if (previous) {
        await this.removeSetIndexes(previous, batch);
      }
      await this.queueSet(batch, this.key(agent.id), JSON.stringify(agent));
      await this.addSetIndexes(agent, batch);
      await this.commitBatch(batch);
      return agent;
    }

    if (previous) {
      await this.removeJsonIndexes(previous);
    }
    await this.client.set(this.key(agent.id), JSON.stringify(agent));
    await this.addJsonIndexes(agent);
    return agent;
  }

  async get(id: string): Promise<RegisteredAgent | null> {
    const value = await this.client.get(this.key(id));
    return value ? (JSON.parse(value) as RegisteredAgent) : null;
  }

  async getAll(): Promise<RegisteredAgent[]> {
    return (await this.list({ limit: Number.MAX_SAFE_INTEGER })).items;
  }

  async list(query: AgentListQuery = {}): Promise<AgentListResult> {
    const candidateIds = await this.findCandidateIds(query);
    const agents = await this.loadAgents(candidateIds);
    return paginateAgents(
      agents.filter((agent) => matchesVisibility(agent, query)),
      query,
    );
  }

  async delete(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) {
      return false;
    }

    if (this.setCommands) {
      const batch = this.createMutationBatch();
      await this.removeSetIndexes(current, batch);
      await this.queueDel(batch, this.key(id));
      await this.commitBatch(batch);
      return true;
    }

    await this.removeJsonIndexes(current);
    return (await this.client.del(this.key(id))) > 0;
  }

  async acquirePollingLease(scope: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const record: RegistryPollingLeaseRecord = {
      scope,
      ownerId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    const key = this.leaseKey(scope);
    const value = JSON.stringify(record);

    const result = await this.client.set(key, value, { NX: true, PX: ttlMs });
    if (isRedisSetSuccess(result)) {
      return true;
    }

    const existing = await this.getPollingLease(scope);
    if (!existing || Date.parse(existing.expiresAt) <= now) {
      await this.client.set(key, value, { PX: ttlMs });
      return true;
    }

    return existing.ownerId === ownerId;
  }

  async releasePollingLease(scope: string, ownerId: string): Promise<void> {
    const existing = await this.getPollingLease(scope);
    if (existing?.ownerId === ownerId) {
      await this.client.del(this.leaseKey(scope));
    }
  }

  async getPollingLease(scope: string): Promise<RegistryPollingLeaseRecord | null> {
    const value = await this.client.get(this.leaseKey(scope));
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as Partial<RegistryPollingLeaseRecord>;
      if (
        typeof parsed.scope === 'string' &&
        typeof parsed.ownerId === 'string' &&
        typeof parsed.acquiredAt === 'string' &&
        typeof parsed.expiresAt === 'string'
      ) {
        return {
          scope: parsed.scope,
          ownerId: parsed.ownerId,
          acquiredAt: parsed.acquiredAt,
          expiresAt: parsed.expiresAt,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async findCandidateIds(query: AgentListQuery): Promise<string[]> {
    const candidateSets: string[][] = [];

    if (query.isPublic === true) {
      candidateSets.push(await this.readIndex(this.indexKey('public', 'true')));
    } else if (query.tenantId && query.includePublic) {
      candidateSets.push(
        uniqueValues([
          ...(await this.readIndex(this.indexKey('tenant', query.tenantId))),
          ...(await this.readIndex(this.indexKey('public', 'true'))),
        ]),
      );
    } else if (query.tenantId) {
      candidateSets.push(await this.readIndex(this.indexKey('tenant', query.tenantId)));
    }

    if (query.status) {
      candidateSets.push(await this.readIndex(this.indexKey('status', query.status)));
    }

    if (query.skill) {
      candidateSets.push(await this.lookupTerms('skill-terms', 'skill', query.skill));
    }

    if (query.tag) {
      candidateSets.push(await this.lookupTerms('tag-terms', 'tag', query.tag));
    }

    if (query.name) {
      candidateSets.push(await this.lookupTerms('name-terms', 'name', query.name));
    }

    if (query.transport) {
      candidateSets.push(await this.readIndex(this.indexKey('transport', query.transport)));
    }

    if (query.mcpCompatible === true) {
      candidateSets.push(await this.readIndex(this.indexKey('mcp', 'true')));
    }

    if (query.mcpCompatible === false) {
      const allIds = await this.readMetaIds('agent-ids');
      const mcpIds = new Set(await this.readIndex(this.indexKey('mcp', 'true')));
      candidateSets.push(allIds.filter((id) => !mcpIds.has(id)));
    }

    if (candidateSets.length === 0) {
      return await this.readMetaIds('agent-ids');
    }

    return intersectArrays(candidateSets);
  }

  private async lookupTerms(metaKey: string, namespace: string, query: string): Promise<string[]> {
    const terms = await this.readMetaIds(metaKey);
    const matchingTerms = terms.filter((term) => termMatchesQuery(term, query.toLowerCase()));
    const matches = await Promise.all(
      matchingTerms.map((term) => this.readIndex(this.indexKey(namespace, term))),
    );
    return uniqueValues(matches.flat());
  }

  private async loadAgents(ids: string[]): Promise<RegisteredAgent[]> {
    if (ids.length === 0) {
      return [];
    }

    const agents = await Promise.all(ids.map((id) => this.get(id)));
    return agents.filter((agent): agent is RegisteredAgent => agent !== null);
  }

  private async addSetIndexes(agent: RegisteredAgent, batch: RedisMutationBatch): Promise<void> {
    const terms = buildAgentIndexTerms(agent);
    await this.queueSadd(batch, this.metaKey('agent-ids'), agent.id);
    await this.queueSadd(batch, this.indexKey('status', terms.status), agent.id);
    if (terms.tenantId) {
      await this.queueSadd(batch, this.metaKey('tenant-terms'), terms.tenantId);
      await this.queueSadd(batch, this.indexKey('tenant', terms.tenantId), agent.id);
    }
    if (terms.isPublic) {
      await this.queueSadd(batch, this.indexKey('public', 'true'), agent.id);
    }
    for (const term of terms.skills) {
      await this.queueSadd(batch, this.metaKey('skill-terms'), term);
      await this.queueSadd(batch, this.indexKey('skill', term), agent.id);
    }
    for (const term of terms.tags) {
      await this.queueSadd(batch, this.metaKey('tag-terms'), term);
      await this.queueSadd(batch, this.indexKey('tag', term), agent.id);
    }
    for (const term of terms.names) {
      await this.queueSadd(batch, this.metaKey('name-terms'), term);
      await this.queueSadd(batch, this.indexKey('name', term), agent.id);
    }
    await this.queueSadd(batch, this.metaKey('transport-terms'), terms.transport);
    await this.queueSadd(batch, this.indexKey('transport', terms.transport), agent.id);
    if (terms.mcpCompatible) {
      await this.queueSadd(batch, this.indexKey('mcp', 'true'), agent.id);
    }
  }

  private async removeSetIndexes(agent: RegisteredAgent, batch: RedisMutationBatch): Promise<void> {
    const terms = buildAgentIndexTerms(agent);
    await this.queueSrem(batch, this.metaKey('agent-ids'), agent.id);
    await this.queueSrem(batch, this.indexKey('status', terms.status), agent.id);
    if (terms.tenantId) {
      await this.queueSrem(batch, this.indexKey('tenant', terms.tenantId), agent.id);
    }
    if (terms.isPublic) {
      await this.queueSrem(batch, this.indexKey('public', 'true'), agent.id);
    }
    for (const term of terms.skills) {
      await this.queueSrem(batch, this.indexKey('skill', term), agent.id);
    }
    for (const term of terms.tags) {
      await this.queueSrem(batch, this.indexKey('tag', term), agent.id);
    }
    for (const term of terms.names) {
      await this.queueSrem(batch, this.indexKey('name', term), agent.id);
    }
    await this.queueSrem(batch, this.indexKey('transport', terms.transport), agent.id);
    if (terms.mcpCompatible) {
      await this.queueSrem(batch, this.indexKey('mcp', 'true'), agent.id);
    }
  }

  private async addJsonIndexes(agent: RegisteredAgent): Promise<void> {
    const terms = buildAgentIndexTerms(agent);
    await this.addMetaValue('agent-ids', agent.id);
    await this.addIndexValue('status', terms.status, agent.id);
    if (terms.tenantId) {
      await this.addMetaValue('tenant-terms', terms.tenantId);
      await this.addIndexValue('tenant', terms.tenantId, agent.id);
    }
    if (terms.isPublic) {
      await this.addIndexValue('public', 'true', agent.id);
    }
    for (const term of terms.skills) {
      await this.addMetaValue('skill-terms', term);
      await this.addIndexValue('skill', term, agent.id);
    }
    for (const term of terms.tags) {
      await this.addMetaValue('tag-terms', term);
      await this.addIndexValue('tag', term, agent.id);
    }
    for (const term of terms.names) {
      await this.addMetaValue('name-terms', term);
      await this.addIndexValue('name', term, agent.id);
    }
    await this.addMetaValue('transport-terms', terms.transport);
    await this.addIndexValue('transport', terms.transport, agent.id);
    if (terms.mcpCompatible) {
      await this.addIndexValue('mcp', 'true', agent.id);
    }
  }

  private async removeJsonIndexes(agent: RegisteredAgent): Promise<void> {
    const terms = buildAgentIndexTerms(agent);
    await this.removeMetaValue('agent-ids', agent.id);
    await this.removeIndexValue('status', terms.status, agent.id);
    if (terms.tenantId) {
      await this.removeIndexValue('tenant', terms.tenantId, agent.id);
      if ((await this.readIndex(this.indexKey('tenant', terms.tenantId))).length === 0) {
        await this.removeMetaValue('tenant-terms', terms.tenantId);
      }
    }
    if (terms.isPublic) {
      await this.removeIndexValue('public', 'true', agent.id);
    }
    for (const term of terms.skills) {
      await this.removeIndexValue('skill', term, agent.id);
      if ((await this.readIndex(this.indexKey('skill', term))).length === 0) {
        await this.removeMetaValue('skill-terms', term);
      }
    }
    for (const term of terms.tags) {
      await this.removeIndexValue('tag', term, agent.id);
      if ((await this.readIndex(this.indexKey('tag', term))).length === 0) {
        await this.removeMetaValue('tag-terms', term);
      }
    }
    for (const term of terms.names) {
      await this.removeIndexValue('name', term, agent.id);
      if ((await this.readIndex(this.indexKey('name', term))).length === 0) {
        await this.removeMetaValue('name-terms', term);
      }
    }
    await this.removeIndexValue('transport', terms.transport, agent.id);
    if ((await this.readIndex(this.indexKey('transport', terms.transport))).length === 0) {
      await this.removeMetaValue('transport-terms', terms.transport);
    }
    if (terms.mcpCompatible) {
      await this.removeIndexValue('mcp', 'true', agent.id);
    }
  }

  private async addIndexValue(namespace: string, value: string, id: string): Promise<void> {
    const key = this.indexKey(namespace, value);
    const ids = uniqueValues([...(await this.readIndex(key)), id]);
    await this.client.set(key, JSON.stringify(ids));
  }

  private async removeIndexValue(namespace: string, value: string, id: string): Promise<void> {
    const key = this.indexKey(namespace, value);
    const ids = (await this.readIndex(key)).filter((candidate) => candidate !== id);
    if (ids.length === 0) {
      await this.client.del(key);
      return;
    }
    await this.client.set(key, JSON.stringify(ids));
  }

  private async addMetaValue(metaKey: string, value: string): Promise<void> {
    const values = uniqueValues([...(await this.readMetaIds(metaKey)), value]);
    await this.client.set(this.metaKey(metaKey), JSON.stringify(values));
  }

  private async removeMetaValue(metaKey: string, value: string): Promise<void> {
    const values = (await this.readMetaIds(metaKey)).filter((entry) => entry !== value);
    if (values.length === 0) {
      await this.client.del(this.metaKey(metaKey));
      return;
    }
    await this.client.set(this.metaKey(metaKey), JSON.stringify(values));
  }

  private async readMetaIds(metaKey: string): Promise<string[]> {
    return this.readJsonArray(this.metaKey(metaKey));
  }

  private async readIndex(key: string): Promise<string[]> {
    return this.readJsonArray(key);
  }

  private async readJsonArray(key: string): Promise<string[]> {
    if (this.setCommands) {
      return this.setCommands.members(key);
    }

    const value = await this.client.get(key);
    if (!value) {
      return [];
    }

    return JSON.parse(value) as string[];
  }

  private key(id: string): string {
    return `${this.prefix}:${id}`;
  }

  private metaKey(name: string): string {
    return `${this.prefix}:meta:${name}`;
  }

  private indexKey(namespace: string, value: string): string {
    return `${this.prefix}:idx:${namespace}:${value}`;
  }

  private leaseKey(scope: string): string {
    return `${this.prefix}:lease:polling:${scope}`;
  }

  private createMutationBatch(): RedisMutationBatch {
    return {
      transaction: this.client.multi?.() ?? null,
      queued: false,
    };
  }

  private async queueSet(batch: RedisMutationBatch, key: string, value: string): Promise<void> {
    if (batch.transaction?.set) {
      batch.transaction.set(key, value);
      batch.queued = true;
      return;
    }
    await this.client.set(key, value);
  }

  private async queueDel(batch: RedisMutationBatch, key: string): Promise<void> {
    if (batch.transaction?.del) {
      batch.transaction.del(key);
      batch.queued = true;
      return;
    }
    await this.client.del(key);
  }

  private async queueSadd(
    batch: RedisMutationBatch,
    key: string,
    ...members: string[]
  ): Promise<void> {
    const add = this.setCommands?.add;
    if (add) {
      await this.queueSetIndexMutation(batch, SADD_METHODS, add, key, ...members);
    }
  }

  private async queueSrem(
    batch: RedisMutationBatch,
    key: string,
    ...members: string[]
  ): Promise<void> {
    const remove = this.setCommands?.remove;
    if (remove) {
      await this.queueSetIndexMutation(batch, SREM_METHODS, remove, key, ...members);
    }
  }

  private async queueSetIndexMutation(
    batch: RedisMutationBatch,
    methods: readonly string[],
    fallback: (key: string, ...members: string[]) => Promise<unknown>,
    key: string,
    ...members: string[]
  ): Promise<void> {
    if (members.length === 0) {
      return;
    }

    if (batch.transaction) {
      const queued = queueSetMutation(batch.transaction, methods, key, members);
      if (queued) {
        batch.queued = true;
        return;
      }
    }

    await fallback(key, ...members);
  }

  private async commitBatch(batch: RedisMutationBatch): Promise<void> {
    if (batch.transaction && batch.queued) {
      await batch.transaction.exec();
    }
  }
}

const SADD_METHODS = ['sadd', 'sAdd', 'SADD'] as const;
const SREM_METHODS = ['srem', 'sRem', 'SREM'] as const;
const SMEMBERS_METHODS = ['smembers', 'sMembers', 'SMEMBERS'] as const;

interface ResolvedRedisMethod {
  name: string;
  method: (...args: unknown[]) => unknown;
}

function resolveSetCommands(client: RegistryRedisClient): RedisSetCommands | null {
  const add = bindSetMutation(client, SADD_METHODS);
  const remove = bindSetMutation(client, SREM_METHODS);
  const members = bindSetMembers(client, SMEMBERS_METHODS);

  if (!add || !remove || !members) {
    return null;
  }

  return { add, remove, members };
}

function bindSetMutation(
  target: RegistryRedisClient,
  names: readonly string[],
): ((key: string, ...members: string[]) => Promise<unknown>) | null {
  const resolved = resolveRedisMethod(target, names);
  if (!resolved) {
    return null;
  }

  return async (key, ...members) =>
    shouldPassMembersAsArray(resolved.name)
      ? resolved.method.call(target, key, members)
      : resolved.method.call(target, key, ...members);
}

function bindSetMembers(
  target: RegistryRedisClient,
  names: readonly string[],
): ((key: string) => Promise<string[]>) | null {
  const resolved = resolveRedisMethod(target, names);
  if (!resolved) {
    return null;
  }

  return async (key) => {
    const result = await resolved.method.call(target, key);
    return Array.isArray(result) ? result : Array.from(result as Iterable<string>);
  };
}

function queueSetMutation(
  target: RegistryRedisTransaction,
  names: readonly string[],
  key: string,
  members: string[],
): boolean {
  const resolved = resolveRedisMethod(target, names);
  if (!resolved) {
    return false;
  }

  if (shouldPassMembersAsArray(resolved.name)) {
    resolved.method.call(target, key, members);
    return true;
  }
  resolved.method.call(target, key, ...members);
  return true;
}

function resolveRedisMethod(target: object, names: readonly string[]): ResolvedRedisMethod | null {
  const record = target as unknown as Record<string, unknown>;
  for (const name of names) {
    const method = record[name];
    if (typeof method !== 'function') {
      continue;
    }

    return { name, method: method as (...args: unknown[]) => unknown };
  }
  return null;
}

function isRedisSetSuccess(value: unknown): boolean {
  return value === 'OK' || value === 'QUEUED' || value === true;
}

function shouldPassMembersAsArray(name: string): boolean {
  return name === 'sAdd' || name === 'sRem';
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function intersectArrays(values: string[][]): string[] {
  const [first, ...rest] = values.sort((left, right) => left.length - right.length);
  if (!first) {
    return [];
  }
  return first.filter((value) => rest.every((entry) => entry.includes(value)));
}
