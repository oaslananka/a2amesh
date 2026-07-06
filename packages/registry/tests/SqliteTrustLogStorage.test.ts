import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';
import { SqliteTrustLogStorage } from '../src/storage/SqliteTrustLogStorage.js';
import type { TrustLogEntryInput } from '../src/storage/ITrustLogStorage.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'a2amesh-trust-log-sqlite-'));
  tempDirectories.push(directory);
  return join(directory, name);
}

function entry(overrides: Partial<TrustLogEntryInput> = {}): TrustLogEntryInput {
  return {
    cardHash: 'card-hash-1',
    keyId: 'key-1',
    algorithm: 'ES256',
    agentUrl: 'http://agent-1',
    timestamp: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('SqliteTrustLogStorage', () => {
  it('assigns sequential zero-based sequence numbers and chains entry hashes', async () => {
    const storage = new SqliteTrustLogStorage(databasePath('trust-log.db'));

    const first = await storage.append(entry({ cardHash: 'card-1' }));
    const second = await storage.append(entry({ cardHash: 'card-2' }));
    const third = await storage.append(entry({ cardHash: 'card-3' }));

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(third.sequence).toBe(2);
    expect(first.entryHash).not.toEqual(second.entryHash);
    expect(second.entryHash).not.toEqual(third.entryHash);
    storage.close();
  });

  it('filters by cardHash and returns entries in append order', async () => {
    const storage = new SqliteTrustLogStorage(databasePath('trust-log.db'));
    await storage.append(entry({ cardHash: 'card-1' }));
    await storage.append(entry({ cardHash: 'card-2' }));
    await storage.append(entry({ cardHash: 'card-1' }));

    const filtered = await storage.list({ cardHash: 'card-1' });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((item) => item.sequence)).toEqual([0, 2]);
    storage.close();
  });

  it('applies limit to return only the most recent entries, in ascending order', async () => {
    const storage = new SqliteTrustLogStorage(databasePath('trust-log.db'));
    await storage.append(entry({ cardHash: 'card-1' }));
    await storage.append(entry({ cardHash: 'card-2' }));
    await storage.append(entry({ cardHash: 'card-3' }));

    const limited = await storage.list({ limit: 2 });
    expect(limited.map((item) => item.cardHash)).toEqual(['card-2', 'card-3']);
    storage.close();
  });

  it('persists entries across a reopen of the same database file and continues the hash chain', async () => {
    const path = databasePath('trust-log.db');
    const first = new SqliteTrustLogStorage(path);
    const entryOne = await first.append(entry({ cardHash: 'card-1' }));
    first.close();

    const reopened = new SqliteTrustLogStorage(path);
    const beforeReopen = await reopened.list();
    expect(beforeReopen).toHaveLength(1);
    expect(beforeReopen[0]).toEqual(entryOne);

    const entryTwo = await reopened.append(entry({ cardHash: 'card-2' }));
    expect(entryTwo.sequence).toBe(1);
    expect(entryTwo.entryHash).not.toEqual(entryOne.entryHash);

    const all = await reopened.list();
    expect(all.map((item) => item.sequence)).toEqual([0, 1]);
    reopened.close();
  });

  it('produces byte-identical entryHash values as InMemoryTrustLogStorage for the same append sequence', async () => {
    const memory = new InMemoryTrustLogStorage();
    const sqlite = new SqliteTrustLogStorage(databasePath('trust-log.db'));
    const inputs = [
      entry({ cardHash: 'card-1', keyId: 'key-a' }),
      entry({ cardHash: 'card-2', keyId: 'key-b', tenantId: 'tenant-a' }),
      entry({ cardHash: 'card-1', keyId: 'key-a', algorithm: 'EdDSA' }),
    ];

    const memoryEntries = [];
    const sqliteEntries = [];
    for (const input of inputs) {
      memoryEntries.push(await memory.append(input));
      sqliteEntries.push(await sqlite.append(input));
    }

    expect(sqliteEntries.map((item) => item.entryHash)).toEqual(
      memoryEntries.map((item) => item.entryHash),
    );
    sqlite.close();
  });
});
