import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AgentRegistryClient } from '../../packages/runtime/src/client/AgentRegistryClient.js';
import type { AgentCard } from '../../packages/runtime/src/types/agent-card.js';
import { RegistryServer } from '../../packages/registry/src/RegistryServer.js';
import type { WorkerCard } from '../../packages/fleet/src/types/domain.js';
import { FleetControlPlaneServer } from '../../packages/fleet-server/src/FleetControlPlaneServer.js';

function workerCard(overrides: Partial<WorkerCard> = {}): WorkerCard {
  return {
    protocolVersion: '1.0',
    name: 'Reviewer Worker',
    description: 'Reviews diffs for style and correctness',
    url: 'http://127.0.0.1:4100',
    version: '1.0.0',
    skills: [
      {
        id: 'code-review',
        name: 'code-review',
        description: 'Reviews diffs.',
      },
    ],
    fleetRoles: ['reviewer'],
    maxConcurrentTasks: 2,
    ...overrides,
  };
}

async function listeningUrl(server: Server): Promise<string> {
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server is not bound to a TCP port');
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

describe('Fleet control-plane server against a real registry', () => {
  const handles: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(handles.map((handle) => handle.close()));
    handles.length = 0;
  });

  it('discovers a worker registered on a live registry and routes a task to it', async () => {
    const registry = new RegistryServer({ allowLocalhost: true });
    const registryServer = registry.start(0);
    handles.push({ close: () => registry.stop() });
    const registryUrl = await listeningUrl(registryServer as Server);

    const registryClient = new AgentRegistryClient(registryUrl);
    await registryClient.register('http://127.0.0.1:4100', workerCard() as AgentCard);

    const fleetServer = new FleetControlPlaneServer({
      registryUrl,
      refreshIntervalMs: 0,
    });
    handles.push({ close: () => fleetServer.stop() });
    const app = fleetServer.getExpressApp();

    const workers = await request(app).get('/fleet/workers');
    expect(workers.body).toEqual([
      expect.objectContaining({
        name: 'Reviewer Worker',
        capabilities: ['code-review'],
      }),
    ]);
    const workerId = workers.body[0].workerId;

    const routed = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'] });

    expect(routed.status).toBe(201);
    expect(routed.body.decision.selectedWorkerId).toBe(workerId);
    expect(routed.body.run).toMatchObject({ workerId, status: 'RUNNING' });
  });
});
