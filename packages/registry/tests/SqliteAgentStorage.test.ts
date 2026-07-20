import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteAgentStorage } from '../src/storage/SqliteAgentStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'a2amesh-registry-sqlite-'));
  temporaryDirectories.push(directory);
  return join(directory, 'registry.sqlite');
}

function agent(id: string, tenantId: string, registeredAt: string): RegisteredAgent {
  return {
    id,
    url: `https://${id}.example.com`,
    card: {
      protocolVersion: '1.0',
      name: `${id} Researcher`,
      description: 'Research agent',
      url: `https://${id}.example.com`,
      version: '1.0.0',
      skills: [
        {
          id: 'research',
          name: 'Research',
          description: 'Find information',
          tags: ['web'],
        },
      ],
    },
    status: 'unknown',
    tags: ['web'],
    skills: ['Research'],
    tenantId,
    registeredAt,
  };
}

describe('SqliteAgentStorage', () => {
  it('persists agents and applies tenant, search, pagination and summary filters', async () => {
    const path = createPath();
    const first = new SqliteAgentStorage(path);
    await first.upsert(agent('agent-a', 'tenant-a', '2026-07-15T10:00:00.000Z'));
    await first.upsert(agent('agent-b', 'tenant-b', '2026-07-15T11:00:00.000Z'));
    first.close();

    const reopened = new SqliteAgentStorage(path);
    await expect(reopened.get('agent-a')).resolves.toEqual(
      expect.objectContaining({ id: 'agent-a', tenantId: 'tenant-a' }),
    );
    await expect(
      reopened.list({ tenantId: 'tenant-a', skill: 'rese', tag: 'web', limit: 1 }),
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        nextCursor: null,
        items: [expect.objectContaining({ id: 'agent-a' })],
      }),
    );
    await reopened.updateStatus('agent-a', 'healthy', {
      consecutiveFailures: 0,
      lastSuccessAt: '2026-07-15T12:00:00.000Z',
    });
    await expect(reopened.summarize({ tenantId: 'tenant-a' })).resolves.toEqual({
      agentCount: 1,
      healthyAgents: 1,
      unhealthyAgents: 0,
      unknownAgents: 0,
      activeTenants: 1,
      publicAgents: 0,
    });
    await expect(reopened.delete('agent-b')).resolves.toBe(true);
    await expect(reopened.delete('agent-b')).resolves.toBe(false);
    reopened.close();
  });

  it('coordinates polling leases atomically and permits takeover after expiry', async () => {
    const path = createPath();
    let now = new Date('2026-07-15T10:00:00.000Z');
    const storage = new SqliteAgentStorage(path, { now: () => now });

    await expect(storage.acquirePollingLease('health', 'pod-a', 5_000)).resolves.toBe(true);
    await expect(storage.acquirePollingLease('health', 'pod-b', 5_000)).resolves.toBe(false);
    await expect(storage.getPollingLease('health')).resolves.toEqual(
      expect.objectContaining({ scope: 'health', ownerId: 'pod-a' }),
    );

    now = new Date('2026-07-15T10:00:06.000Z');
    await expect(storage.acquirePollingLease('health', 'pod-b', 5_000)).resolves.toBe(true);
    await storage.releasePollingLease('health', 'pod-b');
    await expect(storage.getPollingLease('health')).resolves.toBeNull();
    storage.close();
  });
});
