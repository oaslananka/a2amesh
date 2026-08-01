import { describe, expect, it } from 'vitest';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';
import {
  RedisTrustLogStorage,
  type RegistryRedisTrustLogClient,
  type RegistryRedisTrustLogTransaction,
} from '../src/storage/RedisTrustLogStorage.js';
import type { TrustLogEntryInput } from '../src/storage/ITrustLogStorage.js';

interface SharedRedisState {
  values: Map<string, string>;
  lists: Map<string, string[]>;
  version: number;
}

class FakeRedisTrustLogClient implements RegistryRedisTrustLogClient {
  private watchedVersion: number | undefined;
  failExecAttempts = 0;

  constructor(private readonly state: SharedRedisState) {}

  async watch(_keys: string | string[]): Promise<unknown> {
    this.watchedVersion = this.state.version;
    return 'OK';
  }

  async unwatch(): Promise<unknown> {
    this.watchedVersion = undefined;
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.state.values.get(key) ?? null;
  }

  async lLen(key: string): Promise<number> {
    return this.state.lists.get(key)?.length ?? 0;
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const values = this.state.lists.get(key) ?? [];
    const normalizedStop = stop < 0 ? values.length + stop : stop;
    return values.slice(start, normalizedStop + 1);
  }

  multi(): RegistryRedisTrustLogTransaction {
    const commands: Array<() => void> = [];
    return {
      rPush: (key, value) => {
        commands.push(() => {
          const list = this.state.lists.get(key) ?? [];
          list.push(value);
          this.state.lists.set(key, list);
        });
        return this.multiResult(commands);
      },
      set: (key, value) => {
        commands.push(() => this.state.values.set(key, value));
        return this.multiResult(commands);
      },
      exec: async () => this.execute(commands),
    };
  }

  private multiResult(commands: Array<() => void>): RegistryRedisTrustLogTransaction {
    return {
      rPush: (key, value) => {
        commands.push(() => {
          const list = this.state.lists.get(key) ?? [];
          list.push(value);
          this.state.lists.set(key, list);
        });
        return this.multiResult(commands);
      },
      set: (key, value) => {
        commands.push(() => this.state.values.set(key, value));
        return this.multiResult(commands);
      },
      exec: async () => this.execute(commands),
    };
  }

  private async execute(commands: Array<() => void>): Promise<unknown> {
    if (this.failExecAttempts > 0) {
      this.failExecAttempts -= 1;
      const error = new Error('watched key changed');
      error.name = 'WatchError';
      throw error;
    }
    if (this.watchedVersion !== this.state.version) {
      const error = new Error('watched key changed');
      error.name = 'WatchError';
      throw error;
    }
    for (const command of commands) command();
    this.state.version += 1;
    this.watchedVersion = undefined;
    return ['OK'];
  }
}

function input(index: number, cardHash = `card-${index}`): TrustLogEntryInput {
  return {
    cardHash,
    keyId: `key-${index}`,
    algorithm: 'ES256',
    agentUrl: `https://agent-${index}.example.com`,
    tenantId: 'tenant-a',
    timestamp: `2026-08-01T00:00:${String(index).padStart(2, '0')}.000Z`,
  };
}

function sharedState(): SharedRedisState {
  return { values: new Map(), lists: new Map(), version: 0 };
}

describe('RedisTrustLogStorage', () => {
  it('preserves the canonical trust hash chain and list filters', async () => {
    const state = sharedState();
    const redis = new RedisTrustLogStorage(new FakeRedisTrustLogClient(state), 'a2a:test');
    const memory = new InMemoryTrustLogStorage();

    for (const entry of [input(0, 'shared-card'), input(1), input(2, 'shared-card')]) {
      await expect(redis.append(entry)).resolves.toEqual(await memory.append(entry));
    }

    await expect(redis.list()).resolves.toEqual(await memory.list());
    await expect(redis.list({ cardHash: 'shared-card' })).resolves.toEqual(
      await memory.list({ cardHash: 'shared-card' }),
    );
    await expect(redis.list({ limit: 2 })).resolves.toEqual(await memory.list({ limit: 2 }));
  });

  it('retries optimistic transaction conflicts without creating duplicate sequences', async () => {
    const state = sharedState();
    const client = new FakeRedisTrustLogClient(state);
    client.failExecAttempts = 1;
    const storage = new RedisTrustLogStorage(client, 'a2a:test', { maxAppendAttempts: 3 });

    await expect(storage.append(input(0))).resolves.toMatchObject({ sequence: 0 });
    await expect(storage.list()).resolves.toHaveLength(1);
  });

  it('shares ordered entries across independent registry processes', async () => {
    const state = sharedState();
    const first = new RedisTrustLogStorage(new FakeRedisTrustLogClient(state), 'a2a:test');
    const second = new RedisTrustLogStorage(new FakeRedisTrustLogClient(state), 'a2a:test');

    await first.append(input(0));
    await second.append(input(1));

    await expect(first.list()).resolves.toEqual(await second.list());
    await expect(first.list()).resolves.toEqual([
      expect.objectContaining({ sequence: 0, cardHash: 'card-0' }),
      expect.objectContaining({ sequence: 1, cardHash: 'card-1' }),
    ]);
  });
});
