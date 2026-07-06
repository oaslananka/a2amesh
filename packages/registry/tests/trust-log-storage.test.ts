import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';
import type { TrustLogEntryInput } from '../src/storage/ITrustLogStorage.js';

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

describe('InMemoryTrustLogStorage', () => {
  it('assigns sequential sequence numbers and chains entry hashes from a genesis seed', async () => {
    const storage = new InMemoryTrustLogStorage();

    const first = await storage.append(entry({ cardHash: 'card-1' }));
    const second = await storage.append(entry({ cardHash: 'card-2' }));
    const third = await storage.append(entry({ cardHash: 'card-3' }));

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(third.sequence).toBe(2);
    expect(first.entryHash).not.toEqual(second.entryHash);
    expect(second.entryHash).not.toEqual(third.entryHash);
  });

  it('produces a deterministic hash chain that changes if an earlier entry is altered', async () => {
    const storageA = new InMemoryTrustLogStorage();
    const storageB = new InMemoryTrustLogStorage();

    await storageA.append(entry({ cardHash: 'card-1' }));
    const chainA = await storageA.append(entry({ cardHash: 'card-2' }));

    await storageB.append(entry({ cardHash: 'card-1', keyId: 'tampered-key' }));
    const chainB = await storageB.append(entry({ cardHash: 'card-2' }));

    expect(chainA.entryHash).not.toEqual(chainB.entryHash);
  });

  it('recomputes each entryHash from the prior hash plus canonical entry contents', async () => {
    const storage = new InMemoryTrustLogStorage();
    const genesisHash = createHash('sha256').update('a2amesh-trust-log-genesis').digest('hex');

    const first = await storage.append(entry({ cardHash: 'card-1' }));
    const expectedFirstHash = createHash('sha256')
      .update(genesisHash)
      .update(
        JSON.stringify({
          agentUrl: 'http://agent-1',
          algorithm: 'ES256',
          cardHash: 'card-1',
          keyId: 'key-1',
          sequence: 0,
          timestamp: '2026-07-06T00:00:00.000Z',
        }),
      )
      .digest('hex');

    expect(first.entryHash).toBe(expectedFirstHash);
  });

  it('filters by cardHash and returns entries in append order', async () => {
    const storage = new InMemoryTrustLogStorage();
    await storage.append(entry({ cardHash: 'card-1' }));
    await storage.append(entry({ cardHash: 'card-2' }));
    await storage.append(entry({ cardHash: 'card-1' }));

    const filtered = await storage.list({ cardHash: 'card-1' });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((item) => item.sequence)).toEqual([0, 2]);
  });

  it('applies limit to return only the most recent entries', async () => {
    const storage = new InMemoryTrustLogStorage();
    await storage.append(entry({ cardHash: 'card-1' }));
    await storage.append(entry({ cardHash: 'card-2' }));
    await storage.append(entry({ cardHash: 'card-3' }));

    const limited = await storage.list({ limit: 2 });
    expect(limited.map((item) => item.cardHash)).toEqual(['card-2', 'card-3']);
  });

  it('returns defensive copies so callers cannot mutate internal state', async () => {
    const storage = new InMemoryTrustLogStorage();
    const recorded = await storage.append(entry({ cardHash: 'card-1' }));
    recorded.cardHash = 'mutated';

    const listed = await storage.list();
    expect(listed[0]?.cardHash).toBe('card-1');
  });
});
