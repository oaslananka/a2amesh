import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { StaticWorkerDirectory, type FleetRoutingCandidate } from '@a2amesh/internal-fleet';
import type { JwtAuthMiddlewareOptions } from '@a2amesh/runtime';
import { FleetControlPlaneServer } from '../src/FleetControlPlaneServer.js';

const API_KEY_HEADER = 'x-fleet-key';

function candidate(): FleetRoutingCandidate {
  return {
    worker: {
      workerId: 'worker-1',
      card: {
        protocolVersion: '1.0',
        name: 'Worker',
        description: 'Worker',
        url: 'http://127.0.0.1:4100',
        version: '1.0.0',
        skills: [],
      },
      discoveredAt: '2026-07-01T00:00:00.000Z',
      lastHeartbeatAt: '2026-07-01T00:00:00.000Z',
      status: 'IDLE',
      capabilities: [],
      roles: [],
      tenants: ['tenant-a'],
    },
    activeRunCount: 0,
  };
}

function auth(): JwtAuthMiddlewareOptions {
  return {
    securitySchemes: [{ id: 'fleet-key', type: 'apiKey', in: 'header', name: API_KEY_HEADER }],
    apiKeys: {
      'fleet-key': [
        {
          value: 'operator',
          principalId: 'operator-a',
          tenantId: 'tenant-a',
          roles: ['operator'],
        },
        {
          value: 'approver',
          principalId: 'approver-a',
          tenantId: 'tenant-a',
          roles: ['approver'],
        },
        {
          value: 'viewer',
          principalId: 'viewer-a',
          tenantId: 'tenant-a',
          roles: ['viewer'],
        },
      ],
    },
  };
}

describe('Fleet approval idempotency', () => {
  let server: FleetControlPlaneServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('returns the existing approved run without duplicate audit or capacity effects', async () => {
    server = new FleetControlPlaneServer({
      directory: new StaticWorkerDirectory([candidate()]),
      auth: auth(),
      security: { mode: 'production' },
    });
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(API_KEY_HEADER, 'operator')
      .send({ taskId: 'task-idempotent', requiresApproval: true });
    const runId = routed.body.run.id as string;

    const first = await request(app)
      .post(`/fleet/runs/${runId}/approve`)
      .set(API_KEY_HEADER, 'approver')
      .send({});
    const repeated = await request(app)
      .post(`/fleet/runs/${runId}/approve`)
      .set(API_KEY_HEADER, 'approver')
      .send({});

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({
      status: 'RUNNING',
      approvalState: 'APPROVED',
    });

    const audit = await request(app)
      .get('/fleet/audit')
      .set(API_KEY_HEADER, 'viewer')
      .query({ runId });
    expect(
      audit.body.filter((entry: { action: string }) => entry.action === 'run-approved'),
    ).toHaveLength(1);

    const workers = await request(app).get('/fleet/workers').set(API_KEY_HEADER, 'viewer');
    expect(workers.body[0]).toMatchObject({ activeRunCount: 1 });
  });
});
