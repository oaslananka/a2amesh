import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RedisClientType } from 'redis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRegistryProcessConfig } from '../src/bin/config.js';
import { createRegistryStorageResources } from '../src/bin/storage.js';
import { RedisStorage } from '../src/storage/RedisStorage.js';
import { RedisTrustLogStorage } from '../src/storage/RedisTrustLogStorage.js';
import { SqliteAgentStorage } from '../src/storage/SqliteAgentStorage.js';
import { SqliteTrustLogStorage } from '../src/storage/SqliteTrustLogStorage.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

class FakeRedisProcessClient {
  isOpen = false;
  readonly connect = vi.fn(async () => {
    this.isOpen = true;
  });
  readonly close = vi.fn(async () => {
    this.isOpen = false;
  });
  readonly on = vi.fn(() => this);

  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<string> {
    return 'OK';
  }
  async del(): Promise<number> {
    return 0;
  }
  async watch(): Promise<string> {
    return 'OK';
  }
  async unwatch(): Promise<string> {
    return 'OK';
  }
  async lLen(): Promise<number> {
    return 0;
  }
  async lRange(): Promise<string[]> {
    return [];
  }
  multi() {
    const transaction = {
      rPush: () => transaction,
      set: () => transaction,
      exec: async () => ['OK'],
    };
    return transaction;
  }
}

function redisFactory(clients: FakeRedisProcessClient[]) {
  return (_url: string): RedisClientType => {
    const client = clients.shift();
    if (!client) throw new Error('Unexpected Redis client request');
    return client as unknown as RedisClientType;
  };
}

describe('createRegistryStorageResources', () => {
  it('keeps ephemeral memory storage process-local', async () => {
    const resources = await createRegistryStorageResources(
      resolveRegistryProcessConfig({ REGISTRY_STORAGE_BACKEND: 'memory' }),
    );

    expect(resources.storage).toBeUndefined();
    expect(resources.trustLog).toBeUndefined();
    await expect(resources.close()).resolves.toBeUndefined();
  });

  it('opens and closes the configured SQLite agent and trust-log stores', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a2amesh-registry-storage-'));
    temporaryDirectories.push(root);
    const resources = await createRegistryStorageResources(
      resolveRegistryProcessConfig({
        REGISTRY_STORAGE_BACKEND: 'sqlite',
        REGISTRY_SQLITE_PATH: join(root, 'registry.sqlite'),
        REGISTRY_TRUST_LOG_PATH: join(root, 'trust.sqlite'),
      }),
    );

    expect(resources.storage).toBeInstanceOf(SqliteAgentStorage);
    expect(resources.trustLog).toBeInstanceOf(SqliteTrustLogStorage);
    await expect(resources.close()).resolves.toBeUndefined();
  });

  it('uses separate connected Redis clients for directory and trust-log state', async () => {
    const agentClient = new FakeRedisProcessClient();
    const trustClient = new FakeRedisProcessClient();
    const resources = await createRegistryStorageResources(
      resolveRegistryProcessConfig({
        REGISTRY_STORAGE_BACKEND: 'redis',
        REGISTRY_REDIS_URL: 'redis://registry.example.test:6379/0',
        REGISTRY_REDIS_PREFIX: 'a2a:test',
      }),
      { createRedisClient: redisFactory([agentClient, trustClient]) },
    );

    expect(resources.storage).toBeInstanceOf(RedisStorage);
    expect(resources.trustLog).toBeInstanceOf(RedisTrustLogStorage);
    expect(agentClient.connect).toHaveBeenCalledTimes(1);
    expect(trustClient.connect).toHaveBeenCalledTimes(1);

    await resources.close();
    expect(agentClient.close).toHaveBeenCalledTimes(1);
    expect(trustClient.close).toHaveBeenCalledTimes(1);
  });

  it('closes already connected Redis clients when startup fails', async () => {
    const connected = new FakeRedisProcessClient();
    const failed = new FakeRedisProcessClient();
    failed.connect.mockImplementationOnce(async () => {
      throw new Error('redis unavailable');
    });

    await expect(
      createRegistryStorageResources(
        resolveRegistryProcessConfig({
          REGISTRY_STORAGE_BACKEND: 'redis',
          REGISTRY_REDIS_URL: 'redis://registry.example.test:6379/0',
        }),
        { createRedisClient: redisFactory([connected, failed]) },
      ),
    ).rejects.toThrow('redis unavailable');

    expect(connected.close).toHaveBeenCalledTimes(1);
    expect(failed.close).not.toHaveBeenCalled();
  });
});
