import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import { resolveRegistryProcessConfig } from '../../packages/registry/src/bin/config.js';
import {
  createRegistryStorageResources,
  type RegistryStorageResources,
} from '../../packages/registry/src/bin/storage.js';
import { InMemoryTrustLogStorage } from '../../packages/registry/src/storage/InMemoryTrustLogStorage.js';
import type { RedisStorage } from '../../packages/registry/src/storage/RedisStorage.js';
import type { RegisteredAgent } from '../../packages/registry/src/storage/IAgentStorage.js';
import type { TrustLogEntryInput } from '../../packages/registry/src/storage/ITrustLogStorage.js';

const redisUrl = process.env['A2AMESH_TEST_REDIS_URL'];
const redisTest = redisUrl ? it : it.skip;

function agent(id: string): RegisteredAgent {
  return {
    id,
    url: `https://${id}.example.com`,
    card: {
      protocolVersion: '1.0',
      name: id,
      description: 'Redis shared-state integration agent',
      url: `https://${id}.example.com`,
      version: '1.0.0',
      skills: [],
    },
    status: 'healthy',
    tags: ['redis-ha'],
    skills: [],
    tenantId: 'tenant-redis',
    registeredAt: '2026-08-01T00:00:00.000Z',
  };
}

function trustEntry(index: number): TrustLogEntryInput {
  return {
    cardHash: `card-${index}`,
    keyId: `key-${index}`,
    algorithm: 'ES256',
    agentUrl: `https://agent-${index}.example.com`,
    tenantId: 'tenant-redis',
    timestamp: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
}

function processConfig(url: string, prefix: string) {
  return resolveRegistryProcessConfig({
    NODE_ENV: 'production',
    REGISTRY_TOKEN: 'integration-token',
    REGISTRY_STORAGE_BACKEND: 'redis',
    REGISTRY_REDIS_URL: url,
    REGISTRY_REDIS_PREFIX: prefix,
  });
}

describe('registry Redis shared state', () => {
  redisTest(
    'shares agents, polling leases, and a canonical trust chain across processes and reconnects',
    async () => {
      if (!redisUrl) return;
      const prefix = `a2a:registry:ha:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      const resources: RegistryStorageResources[] = [];
      const first = await createRegistryStorageResources(processConfig(redisUrl, prefix));
      const second = await createRegistryStorageResources(processConfig(redisUrl, prefix));
      resources.push(first, second);

      try {
        const agentsA = first.storage as RedisStorage;
        const agentsB = second.storage as RedisStorage;
        const trustA = first.trustLog!;
        const trustB = second.trustLog!;

        await agentsA.upsert(agent('agent-a'));
        await expect(agentsB.get('agent-a')).resolves.toMatchObject({ id: 'agent-a' });

        await expect(agentsA.acquirePollingLease('health', 'registry-a', 30_000)).resolves.toBe(
          true,
        );
        await expect(agentsB.acquirePollingLease('health', 'registry-b', 30_000)).resolves.toBe(
          false,
        );
        await agentsA.releasePollingLease('health', 'registry-a');
        await expect(agentsB.acquirePollingLease('health', 'registry-b', 30_000)).resolves.toBe(
          true,
        );

        const inputs = Array.from({ length: 12 }, (_, index) => trustEntry(index));
        await Promise.all([
          ...inputs.filter((_, index) => index % 2 === 0).map((entry) => trustA.append(entry)),
          ...inputs.filter((_, index) => index % 2 === 1).map((entry) => trustB.append(entry)),
        ]);

        const recorded = await trustA.list();
        expect(recorded).toHaveLength(inputs.length);
        expect(recorded.map((entry) => entry.sequence)).toEqual(
          Array.from({ length: inputs.length }, (_, index) => index),
        );

        const canonical = new InMemoryTrustLogStorage();
        const expected = [];
        for (const entry of recorded) {
          expected.push(
            await canonical.append({
              cardHash: entry.cardHash,
              keyId: entry.keyId,
              algorithm: entry.algorithm,
              agentUrl: entry.agentUrl,
              ...(entry.tenantId ? { tenantId: entry.tenantId } : {}),
              timestamp: entry.timestamp,
            }),
          );
        }
        expect(recorded).toEqual(expected);

        await Promise.all(resources.map((resource) => resource.close()));
        resources.length = 0;
        const reconnected = await createRegistryStorageResources(processConfig(redisUrl, prefix));
        resources.push(reconnected);

        await expect(reconnected.storage!.get('agent-a')).resolves.toMatchObject({ id: 'agent-a' });
        await expect(reconnected.trustLog!.list()).resolves.toEqual(recorded);
      } finally {
        await Promise.all(resources.map((resource) => resource.close()));
        const cleanup = createClient({ url: redisUrl });
        cleanup.on('error', () => undefined);
        await cleanup.connect();
        try {
          const keys = await cleanup.keys(`${prefix}:*`);
          if (keys.length > 0) await cleanup.del(keys);
        } finally {
          await cleanup.close();
        }
      }
    },
    30_000,
  );
});
