import { createClient, type RedisClientType } from 'redis';
import type { IAgentStorage } from '../storage/IAgentStorage.js';
import type { ITrustLogStorage } from '../storage/ITrustLogStorage.js';
import { RedisStorage, type RegistryRedisClient } from '../storage/RedisStorage.js';
import {
  RedisTrustLogStorage,
  type RegistryRedisTrustLogClient,
} from '../storage/RedisTrustLogStorage.js';
import { SqliteAgentStorage } from '../storage/SqliteAgentStorage.js';
import { SqliteTrustLogStorage } from '../storage/SqliteTrustLogStorage.js';
import type { RegistryProcessConfig } from './config.js';

export interface RegistryStorageResources {
  storage?: IAgentStorage;
  trustLog?: ITrustLogStorage;
  close(): Promise<void>;
}

export interface RegistryStorageFactoryOptions {
  createRedisClient?: (url: string) => RedisClientType;
}

export async function createRegistryStorageResources(
  config: RegistryProcessConfig,
  options: RegistryStorageFactoryOptions = {},
): Promise<RegistryStorageResources> {
  if (config.storageBackend === 'memory') {
    return { close: async () => undefined };
  }

  if (config.storageBackend === 'sqlite') {
    const sqlitePath = config.sqlitePath;
    if (!sqlitePath) {
      throw new Error('SQLite registry storage requires a configured database path.');
    }
    const storage = new SqliteAgentStorage(sqlitePath);
    const trustLog = config.trustLogPath
      ? new SqliteTrustLogStorage(config.trustLogPath)
      : undefined;
    return {
      storage,
      ...(trustLog ? { trustLog } : {}),
      close: async () => {
        storage.close();
        trustLog?.close();
      },
    };
  }

  const redisUrl = config.redisUrl;
  if (!redisUrl) {
    throw new Error('Redis registry storage requires a configured connection URL.');
  }
  const create = options.createRedisClient ?? ((url: string) => createClient({ url }));
  const agentClient = create(redisUrl);
  const trustLogClient = create(redisUrl);
  const clients = [agentClient, trustLogClient];
  const connectionResults = await Promise.allSettled(clients.map((client) => client.connect()));
  const connectionFailure = connectionResults.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (connectionFailure) {
    await Promise.all(
      clients.map(async (client) => {
        if (client.isOpen) await client.close().catch(() => undefined);
      }),
    );
    throw connectionFailure.reason;
  }

  return {
    storage: new RedisStorage(agentClient as unknown as RegistryRedisClient, config.redisPrefix),
    trustLog: new RedisTrustLogStorage(
      trustLogClient as unknown as RegistryRedisTrustLogClient,
      config.redisPrefix,
    ),
    close: async () => {
      await Promise.all(
        clients.map(async (client) => {
          if (client.isOpen) await client.close();
        }),
      );
    },
  };
}
