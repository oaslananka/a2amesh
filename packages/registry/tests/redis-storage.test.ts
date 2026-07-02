import { describe, expect, it } from 'vitest';
import { RedisStorage, type RegistryRedisClient } from '../src/storage/RedisStorage.js';
import type { AgentStatus, RegisteredAgent } from '../src/storage/IAgentStorage.js';

type QueuedOperation = () => Promise<unknown>;

interface NodeRedisModule {
  createClient(options: { url: string }): NodeRedisClient;
}

interface NodeRedisClient extends RegistryRedisClient {
  connect(): Promise<void>;
  quit(): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  del(key: string | string[]): Promise<number>;
  sAdd(key: string, members: string | string[]): Promise<number>;
  sRem(key: string, members: string | string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  multi(): NodeRedisTransaction;
}

interface NodeRedisTransaction {
  set(key: string, value: string): NodeRedisTransaction;
  del(key: string): NodeRedisTransaction;
  sAdd(key: string, members: string | string[]): NodeRedisTransaction;
  sRem(key: string, members: string | string[]): NodeRedisTransaction;
  exec(): Promise<unknown>;
}

class RaceyAtomicRedisClient implements RegistryRedisClient {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly indexJsonWrites: string[] = [];
  readonly saddCalls: Array<{ key: string; members: string[] }> = [];
  readonly sremCalls: Array<{ key: string; members: string[] }> = [];
  execCalls = 0;

  private readonly raceKeySuffixes = new Set<string>();
  private readonly waiters = new Map<string, Array<() => void>>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    if (isNxSet(args) && (this.values.has(key) || this.sets.has(key))) {
      return null;
    }
    if (this.isIndexOrMetaKey(key)) {
      this.indexJsonWrites.push(key);
    }
    if (this.shouldRaceJsonWrite(key)) {
      await this.waitForCompetingWrite(key);
    }
    this.values.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const removedValue = this.values.delete(key);
    const removedSet = this.sets.delete(key);
    return removedValue || removedSet ? 1 : 0;
  }

  async scan(
    _cursor: string | number,
    _matchOption: 'MATCH',
    pattern: string,
    _countOption?: 'COUNT',
    _count?: number,
  ): Promise<[string, string[]]> {
    const prefix = pattern.replaceAll('*', '');
    return [
      '0',
      uniqueValues([
        ...Array.from(this.values.keys()).filter((key) => key.startsWith(prefix)),
        ...Array.from(this.sets.keys()).filter((key) => key.startsWith(prefix)),
      ]),
    ];
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replaceAll('*', '');
    return uniqueValues([
      ...Array.from(this.values.keys()).filter((key) => key.startsWith(prefix)),
      ...Array.from(this.sets.keys()).filter((key) => key.startsWith(prefix)),
    ]);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.saddCalls.push({ key, members });
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    for (const member of members) {
      set.add(member);
    }
    this.sets.set(key, set);
    return set.size - before;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.sremCalls.push({ key, members });
    const set = this.sets.get(key);
    if (!set) {
      return 0;
    }
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    if (set.size === 0) {
      this.sets.delete(key);
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  multi(): RaceyAtomicRedisTransaction {
    return new RaceyAtomicRedisTransaction(this);
  }

  enableRaceForJsonArrayKeys(...keySuffixes: string[]): void {
    for (const suffix of keySuffixes) {
      this.raceKeySuffixes.add(suffix);
    }
  }

  resetCallHistory(): void {
    this.indexJsonWrites.length = 0;
    this.saddCalls.length = 0;
    this.sremCalls.length = 0;
    this.execCalls = 0;
  }

  readStoredMembers(key: string): string[] {
    const set = this.sets.get(key);
    if (set) {
      return Array.from(set);
    }
    const value = this.values.get(key);
    return value ? (JSON.parse(value) as string[]) : [];
  }

  private isIndexOrMetaKey(key: string): boolean {
    return key.includes(':idx:') || key.includes(':meta:');
  }

  private shouldRaceJsonWrite(key: string): boolean {
    return Array.from(this.raceKeySuffixes).some((suffix) => key.endsWith(suffix));
  }

  private waitForCompetingWrite(key: string): Promise<void> {
    return new Promise((resolve) => {
      const waiters = this.waiters.get(key) ?? [];
      waiters.push(resolve);
      if (waiters.length >= 2) {
        this.waiters.delete(key);
        for (const waiter of waiters) {
          waiter();
        }
        return;
      }
      this.waiters.set(key, waiters);
    });
  }
}

class RaceyAtomicRedisTransaction {
  private readonly operations: QueuedOperation[] = [];

  constructor(private readonly client: RaceyAtomicRedisClient) {}

  set(key: string, value: string): this {
    this.operations.push(() => this.client.set(key, value));
    return this;
  }

  del(key: string): this {
    this.operations.push(() => this.client.del(key));
    return this;
  }

  sadd(key: string, ...members: string[]): this {
    this.operations.push(() => this.client.sadd(key, ...members));
    return this;
  }

  srem(key: string, ...members: string[]): this {
    this.operations.push(() => this.client.srem(key, ...members));
    return this;
  }

  async exec(): Promise<unknown[]> {
    this.client.execCalls += 1;
    const results: unknown[] = [];
    for (const operation of this.operations) {
      results.push(await operation());
    }
    return results;
  }
}


function isNxSet(args: unknown[]): boolean {
  return args.some(
    (arg) =>
      typeof arg === 'object' &&
      arg !== null &&
      (arg as { NX?: unknown; nx?: unknown }).NX === true ||
      (typeof arg === 'object' && arg !== null && (arg as { nx?: unknown }).nx === true),
  );
}

function createStorage() {
  const values = new Map<string, string>();
  const storage = new RedisStorage({
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async del(key) {
      return values.delete(key) ? 1 : 0;
    },
    async scan(_cursor, _matchOption, pattern, _countOption, _count) {
      const prefix = pattern.replaceAll('*', '');
      return ['0', Array.from(values.keys()).filter((key) => key.startsWith(prefix))];
    },
    async keys(pattern) {
      const prefix = pattern.replaceAll('*', '');
      return Array.from(values.keys()).filter((key) => key.startsWith(prefix));
    },
  });

  return { storage, values };
}

function agent(
  id: string,
  overrides: Partial<RegisteredAgent> & {
    name?: string;
    status?: AgentStatus;
    skillNames?: string[];
  } = {},
): RegisteredAgent {
  const skillNames = overrides.skillNames ?? overrides.skills ?? [];
  const result: RegisteredAgent = {
    id,
    url: `http://${id}`,
    card: {
      protocolVersion: '1.0',
      name: overrides.name ?? id,
      description: 'desc',
      url: `http://${id}`,
      version: '1.0',
      transport: overrides.card?.transport ?? 'http',
      capabilities: overrides.card?.capabilities ?? { streaming: true },
      skills: skillNames.map((name, index) => ({
        id: `${id}-skill-${index}`,
        name,
        description: `${name} skill`,
        tags: overrides.tags ?? [],
      })),
    },
    status: overrides.status ?? 'unknown',
    tags: overrides.tags ?? [],
    skills: skillNames,
    registeredAt: overrides.registeredAt ?? new Date().toISOString(),
  };
  if (overrides.isPublic !== undefined) {
    result.isPublic = overrides.isPublic;
  }
  if (overrides.tenantId !== undefined) {
    result.tenantId = overrides.tenantId;
  }
  return result;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function loadNodeRedisModule(): Promise<NodeRedisModule> {
  const packageName = 'redis';
  return (await import(packageName)) as NodeRedisModule;
}

const redisIntegrationUrl = process.env['A2AMESH_REDIS_URL'];
const redisIntegrationTest = redisIntegrationUrl ? it : it.skip;

describe('RedisStorage', () => {
  it('persists and retrieves JSON records through a redis-like client', async () => {
    const { storage } = createStorage();

    await storage.upsert({
      id: 'agent-1',
      url: 'http://agent-1',
      card: {
        protocolVersion: '1.0',
        name: 'Agent 1',
        description: 'desc',
        url: 'http://agent-1',
        version: '1.0',
      },
      status: 'healthy',
      tags: [],
      skills: ['Search'],
      registeredAt: new Date().toISOString(),
    });

    expect(await storage.getAll()).toHaveLength(1);
    expect((await storage.findBySkill('sea'))[0]?.id).toBe('agent-1');
  });

  it('updates statuses, ignores missing agents and reports failed deletes', async () => {
    const { storage } = createStorage();

    await storage.upsert({
      id: 'agent-1',
      url: 'http://agent-1',
      card: {
        protocolVersion: '1.0',
        name: 'Agent 1',
        description: 'desc',
        url: 'http://agent-1',
        version: '1.0',
      },
      status: 'unknown',
      tags: [],
      skills: [],
      registeredAt: new Date().toISOString(),
    });

    await storage.updateStatus('agent-1', 'healthy');
    await storage.updateStatus('missing', 'unhealthy');

    expect((await storage.get('agent-1'))?.status).toBe('healthy');
    expect(await storage.delete('missing')).toBe(false);
  });

  it('maintains indexed list and summary queries across upserts and deletes', async () => {
    const { storage } = createStorage();
    await storage.upsert(
      agent('agent-a', {
        name: 'Alpha Researcher',
        status: 'healthy',
        skillNames: ['Research'],
        tags: ['web'],
        tenantId: 'tenant-a',
        registeredAt: '2026-04-06T10:00:00.000Z',
        card: {
          protocolVersion: '1.0',
          name: 'Alpha Researcher',
          description: 'desc',
          url: 'http://agent-a',
          version: '1.0',
          transport: 'http',
          capabilities: { streaming: true, mcpCompatible: true },
        },
      }),
    );
    await storage.upsert(
      agent('agent-b', {
        name: 'Public Writer',
        status: 'unknown',
        skillNames: ['Write'],
        tags: ['text'],
        isPublic: true,
        registeredAt: '2026-04-06T10:01:00.000Z',
      }),
    );
    await storage.upsert(
      agent('agent-c', {
        name: 'Tenant B Analyzer',
        status: 'unhealthy',
        skillNames: ['Analyze'],
        tags: ['data'],
        tenantId: 'tenant-b',
        registeredAt: '2026-04-06T10:02:00.000Z',
      }),
    );

    await expect(storage.list({ tenantId: 'tenant-a', includePublic: true })).resolves.toEqual(
      expect.objectContaining({ total: 2 }),
    );
    await expect(storage.list({ isPublic: true })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-b' })] }),
    );
    await expect(storage.list({ status: 'healthy', skill: 'rese', tag: 'web' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-a' })] }),
    );
    await expect(storage.list({ name: 'writer', transport: 'http' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-b' })] }),
    );
    await expect(storage.list({ mcpCompatible: true })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-a' })] }),
    );
    await expect(storage.list({ mcpCompatible: false, cursor: 'bad', limit: 1 })).resolves.toEqual(
      expect.objectContaining({ total: 2, nextCursor: '1' }),
    );
    await expect(storage.summarize({ tenantId: 'tenant-a', includePublic: true })).resolves.toEqual(
      expect.objectContaining({
        agentCount: 2,
        healthyAgents: 1,
        unknownAgents: 1,
        activeTenants: 1,
        publicAgents: 1,
      }),
    );

    await storage.upsert(agent('agent-a', { status: 'unhealthy', skillNames: ['Research'] }));
    expect((await storage.list({ status: 'healthy' })).items.map((item) => item.id)).not.toContain(
      'agent-a',
    );
    await expect(storage.delete('agent-a')).resolves.toBe(true);
    await expect(storage.findBySkill('rese')).resolves.toEqual([]);
  });

  it('uses redis set indexes to preserve concurrent upsert members', async () => {
    const client = new RaceyAtomicRedisClient();
    const storage = new RedisStorage(client);
    client.enableRaceForJsonArrayKeys(':meta:agent-ids', ':idx:status:healthy');

    await Promise.all([
      storage.upsert(
        agent('agent-a', {
          status: 'healthy',
          skillNames: ['Research'],
          registeredAt: '2026-04-06T10:00:00.000Z',
        }),
      ),
      storage.upsert(
        agent('agent-b', {
          status: 'healthy',
          skillNames: ['Write'],
          registeredAt: '2026-04-06T10:01:00.000Z',
        }),
      ),
    ]);

    const healthyIds = (await storage.list({ status: 'healthy' })).items.map((item) => item.id);
    expect(new Set(healthyIds)).toEqual(new Set(['agent-a', 'agent-b']));
    expect(client.indexJsonWrites).toEqual([]);
    expect(client.saddCalls.length).toBeGreaterThan(0);
    expect(client.execCalls).toBeGreaterThan(0);
  });

  it('uses redis set indexes to preserve concurrent delete removals', async () => {
    const client = new RaceyAtomicRedisClient();
    const storage = new RedisStorage(client);

    await storage.upsert(
      agent('agent-a', {
        status: 'healthy',
        registeredAt: '2026-04-06T10:00:00.000Z',
      }),
    );
    await storage.upsert(
      agent('agent-b', {
        status: 'healthy',
        registeredAt: '2026-04-06T10:01:00.000Z',
      }),
    );

    client.resetCallHistory();
    client.enableRaceForJsonArrayKeys(':meta:agent-ids', ':idx:status:healthy');

    await Promise.all([storage.delete('agent-a'), storage.delete('agent-b')]);

    expect(client.readStoredMembers('a2a:registry:meta:agent-ids')).toEqual([]);
    expect(client.readStoredMembers('a2a:registry:idx:status:healthy')).toEqual([]);
    expect(client.indexJsonWrites).toEqual([]);
    expect(client.sremCalls.length).toBeGreaterThan(0);
    expect(client.execCalls).toBeGreaterThan(0);
  });


  it('uses redis leases to coordinate distributed polling ownership', async () => {
    const client = new RaceyAtomicRedisClient();
    const storage = new RedisStorage(client);

    await expect(storage.acquirePollingLease('health', 'node-a', 30_000)).resolves.toBe(true);
    await expect(storage.acquirePollingLease('health', 'node-b', 30_000)).resolves.toBe(false);
    await expect(storage.getPollingLease('health')).resolves.toEqual(
      expect.objectContaining({ scope: 'health', ownerId: 'node-a' }),
    );

    await storage.releasePollingLease('health', 'node-b');
    await expect(storage.getPollingLease('health')).resolves.toEqual(
      expect.objectContaining({ ownerId: 'node-a' }),
    );

    await storage.releasePollingLease('health', 'node-a');
    await expect(storage.getPollingLease('health')).resolves.toBeNull();
  });

  it('recovers stale redis polling leases by overwriting expired records', async () => {
    const client = new RaceyAtomicRedisClient();
    const storage = new RedisStorage(client);
    client.values.set(
      'a2a:registry:lease:polling:health',
      JSON.stringify({
        scope: 'health',
        ownerId: 'stale-node',
        acquiredAt: '2026-04-06T10:00:00.000Z',
        expiresAt: '2026-04-06T10:00:01.000Z',
      }),
    );

    await expect(storage.acquirePollingLease('health', 'node-b', 30_000)).resolves.toBe(true);
    await expect(storage.getPollingLease('health')).resolves.toEqual(
      expect.objectContaining({ ownerId: 'node-b' }),
    );
  });

  redisIntegrationTest(
    'uses atomic indexes with a real redis client when A2AMESH_REDIS_URL is set',
    async () => {
      if (!redisIntegrationUrl) {
        return;
      }

      const redis = await loadNodeRedisModule();
      const client = redis.createClient({ url: redisIntegrationUrl });
      const prefix = `a2a:registry:test:${Date.now()}:${Math.random().toString(16).slice(2)}`;

      await client.connect();
      try {
        const storage = new RedisStorage(client, prefix);

        await Promise.all([
          storage.upsert(agent('agent-a', { status: 'healthy' })),
          storage.upsert(agent('agent-b', { status: 'healthy' })),
        ]);

        const healthyIds = (await storage.list({ status: 'healthy' })).items.map((item) => item.id);
        expect(new Set(healthyIds)).toEqual(new Set(['agent-a', 'agent-b']));

        await Promise.all([storage.delete('agent-a'), storage.delete('agent-b')]);
        expect(await storage.getAll()).toEqual([]);
      } finally {
        const keys = await client.keys(`${prefix}:*`);
        if (keys.length > 0) {
          await client.del(keys);
        }
        await client.quit();
      }
    },
  );
});
