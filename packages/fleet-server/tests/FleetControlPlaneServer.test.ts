import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { StaticWorkerDirectory, type FleetRoutingCandidate } from '@a2amesh/internal-fleet';
import type { JwtAuthMiddlewareOptions } from '@a2amesh/runtime';
import { FleetControlPlaneServer } from '../src/FleetControlPlaneServer.js';

function candidate(overrides: Partial<FleetRoutingCandidate> = {}): FleetRoutingCandidate {
  return {
    worker: {
      workerId: 'worker-1',
      card: {
        protocolVersion: '1.0',
        name: 'Worker One',
        description: 'a worker',
        url: 'http://worker.local',
        version: '1.0.0',
      },
      discoveredAt: '2026-07-05T00:00:00.000Z',
      lastHeartbeatAt: '2026-07-05T00:00:00.000Z',
      status: 'IDLE',
      capabilities: ['code-review'],
      roles: ['reviewer'],
    },
    activeRunCount: 0,
    ...overrides,
  };
}

describe('FleetControlPlaneServer', () => {
  let server: FleetControlPlaneServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('lists live worker health from the injected directory', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });

    const response = await request(server.getExpressApp()).get('/fleet/workers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        workerId: 'worker-1',
        status: 'IDLE',
        capabilities: ['code-review'],
      }),
    ]);
  });

  it('routes a task, dispatches immediately when no approval is required, and records audit', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });
    const app = server.getExpressApp();

    const response = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'] });

    expect(response.status).toBe(201);
    expect(response.body.decision.selectedWorkerId).toBe('worker-1');
    expect(response.body.run).toMatchObject({
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'RUNNING',
      approvalState: 'NOT_REQUIRED',
    });

    const audit = await request(app).get('/fleet/audit');
    expect(audit.body).toEqual([
      expect.objectContaining({ action: 'task-routed', runId: response.body.run.id }),
    ]);
  });

  it('returns a null run when no worker satisfies the requested capability', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });

    const response = await request(server.getExpressApp())
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['nonexistent-capability'] });

    expect(response.status).toBe(200);
    expect(response.body.run).toBeNull();
    expect(response.body.decision.selectedWorkerId).toBeUndefined();
  });

  it('holds a run for approval when requiresApproval is set, and dispatches only after approve', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });
    const app = server.getExpressApp();

    const routed = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'], requiresApproval: true });

    expect(routed.body.run).toMatchObject({ status: 'PENDING', approvalState: 'PENDING' });
    const runId = routed.body.run.id;

    const pending = await request(app).get('/fleet/runs').query({ approvalState: 'PENDING' });
    expect(pending.body.map((run: { id: string }) => run.id)).toEqual([runId]);

    const approved = await request(app)
      .post(`/fleet/runs/${runId}/approve`)
      .send({ actor: 'operator-1' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'RUNNING', approvalState: 'APPROVED' });

    const audit = await request(app).get('/fleet/audit').query({ runId });
    expect(audit.body.map((entry: { action: string }) => entry.action)).toEqual([
      'run-pending-approval',
      'run-approved',
    ]);
  });

  it('holds a run for approval automatically for a high-risk level even without requiresApproval', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });

    const routed = await request(server.getExpressApp())
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'], riskLevel: 'publish' });

    expect(routed.body.run).toMatchObject({ status: 'PENDING', approvalState: 'PENDING' });
  });

  it('rejects a pending run and marks it FAILED', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });
    const app = server.getExpressApp();

    const routed = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'], requiresApproval: true });
    const runId = routed.body.run.id;

    const rejected = await request(app)
      .post(`/fleet/runs/${runId}/reject`)
      .send({ actor: 'operator-1', reason: 'not safe' });

    expect(rejected.body).toMatchObject({
      status: 'FAILED',
      approvalState: 'REJECTED',
      failureReason: 'not safe',
    });
  });

  it('returns 409 when approving a run that is not pending', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });
    const app = server.getExpressApp();

    const routed = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'] });
    const runId = routed.body.run.id;

    const response = await request(app).post(`/fleet/runs/${runId}/approve`).send({});
    expect(response.status).toBe(409);
  });

  it('completes a run with validated artifacts and rejects an invalid artifact', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([candidate()]) });
    const app = server.getExpressApp();

    const routed = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'] });
    const runId = routed.body.run.id;

    const badArtifact = await request(app)
      .post(`/fleet/runs/${runId}/complete`)
      .send({ status: 'COMPLETED', artifacts: [{ artifactId: '', kind: 'plan' }] });
    expect(badArtifact.status).toBe(400);

    const completed = await request(app)
      .post(`/fleet/runs/${runId}/complete`)
      .send({
        status: 'COMPLETED',
        artifacts: [
          {
            artifactId: 'artifact-1',
            kind: 'plan',
            taskId: 'task-1',
            contentType: 'text/markdown',
            sensitivity: 'internal',
            redacted: false,
            provenance: { producerId: 'worker-1', taskId: 'task-1' },
            createdAt: '2026-07-05T00:00:00.000Z',
            content: 'plan content',
          },
        ],
      });

    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');

    const artifacts = await request(app).get(`/fleet/runs/${runId}/artifacts`);
    expect(artifacts.body).toHaveLength(1);
  });

  it('returns 404 for an unknown run id', async () => {
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([]) });

    const response = await request(server.getExpressApp()).get('/fleet/runs/does-not-exist');
    expect(response.status).toBe(404);
  });

  it("frees a worker's active run slot once a run completes, so a concurrency-limited worker can accept new work", async () => {
    const limited = candidate({ maxConcurrentTasks: 1 });
    server = new FleetControlPlaneServer({ directory: new StaticWorkerDirectory([limited]) });
    const app = server.getExpressApp();

    const first = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-1', requiredCapabilities: ['code-review'] });
    expect(first.body.run.status).toBe('RUNNING');

    const secondWhileBusy = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-2', requiredCapabilities: ['code-review'] });
    expect(secondWhileBusy.body.run).toBeNull();

    await request(app)
      .post(`/fleet/runs/${first.body.run.id}/complete`)
      .send({ status: 'COMPLETED' });

    const thirdAfterCompletion = await request(app)
      .post('/fleet/tasks/route')
      .send({ taskId: 'task-3', requiredCapabilities: ['code-review'] });
    expect(thirdAfterCompletion.body.run).not.toBeNull();
  });
});

const FLEET_API_KEY_HEADER = 'x-fleet-key';

function fleetAuth(): JwtAuthMiddlewareOptions {
  return {
    securitySchemes: [
      { id: 'fleet-key', type: 'apiKey', in: 'header', name: FLEET_API_KEY_HEADER },
    ],
    apiKeys: {
      'fleet-key': [
        {
          value: 'unprivileged-a',
          principalId: 'unprivileged-a',
          tenantId: 'tenant-a',
          roles: [],
        },
        {
          value: 'viewer-a',
          principalId: 'viewer-a',
          tenantId: 'tenant-a',
          roles: ['viewer'],
        },
        {
          value: 'viewer-b',
          principalId: 'viewer-b',
          tenantId: 'tenant-b',
          roles: ['viewer'],
        },
        {
          value: 'operator-a',
          principalId: 'operator-a',
          tenantId: 'tenant-a',
          roles: ['operator'],
        },
        {
          value: 'approver-a',
          principalId: 'approver-a',
          tenantId: 'tenant-a',
          roles: ['approver'],
        },
        {
          value: 'approver-2-a',
          principalId: 'approver-2-a',
          tenantId: 'tenant-a',
          roles: ['approver'],
        },
        {
          value: 'dual-a',
          principalId: 'dual-a',
          tenantId: 'tenant-a',
          roles: ['operator', 'approver'],
        },
        {
          value: 'complete-scope-a',
          principalId: 'complete-scope-a',
          tenantId: 'tenant-a',
          scopes: ['fleet:runs:complete'],
          roles: [],
        },
        {
          value: 'worker-a',
          principalId: 'worker-principal-a',
          tenantId: 'tenant-a',
          roles: ['worker'],
          claims: { workerId: 'worker-1' },
        },
        {
          value: 'wrong-worker-a',
          principalId: 'wrong-worker-principal-a',
          tenantId: 'tenant-a',
          roles: ['worker'],
          claims: { workerId: 'worker-2' },
        },
        {
          value: 'admin',
          principalId: 'admin',
          roles: ['administrator'],
        },
      ],
    },
  };
}

function secureServer(
  options: ConstructorParameters<typeof FleetControlPlaneServer>[0] = {
    directory: new StaticWorkerDirectory([candidate()]),
  },
): FleetControlPlaneServer {
  return new FleetControlPlaneServer({
    directory: new StaticWorkerDirectory([candidate()]),
    ...options,
    auth: fleetAuth(),
    security: { mode: 'production', ...options.security },
  });
}

describe('FleetControlPlaneServer security boundary', () => {
  let server: FleetControlPlaneServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('fails closed in production mode without authentication', () => {
    expect(
      () =>
        new FleetControlPlaneServer({
          directory: new StaticWorkerDirectory([candidate()]),
          security: { mode: 'production' },
        }),
    ).toThrow('production mode requires authentication');
  });

  it('rejects an external bind when authentication is not configured', () => {
    expect(
      () =>
        new FleetControlPlaneServer({
          directory: new StaticWorkerDirectory([candidate()]),
          host: '0.0.0.0',
        }),
    ).toThrow('authentication is required for non-loopback binding');
  });

  it('binds to loopback by default', async () => {
    server = new FleetControlPlaneServer({
      directory: new StaticWorkerDirectory([candidate()]),
    });
    const handle = server.start(0);
    if (!handle.listening) {
      await new Promise<void>((resolve) => handle.once('listening', resolve));
    }
    expect((handle.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('rejects unlisted browser origins while allowing no-origin clients and configured origins', async () => {
    server = secureServer({
      directory: new StaticWorkerDirectory([candidate()]),
      security: { mode: 'production', allowedOrigins: ['https://mission.example'] },
    });
    const app = server.getExpressApp();

    const rejected = await request(app)
      .get('/fleet/workers')
      .set(FLEET_API_KEY_HEADER, 'viewer-a')
      .set('origin', 'https://attacker.example');
    expect(rejected.status).toBe(403);

    const allowed = await request(app)
      .get('/fleet/workers')
      .set(FLEET_API_KEY_HEADER, 'viewer-a')
      .set('origin', 'https://mission.example');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://mission.example');

    const noOrigin = await request(app).get('/fleet/workers').set(FLEET_API_KEY_HEADER, 'viewer-a');
    expect(noOrigin.status).toBe(200);
  });

  it('requires authentication and enforces the viewer/operator role boundary', async () => {
    server = secureServer();
    const app = server.getExpressApp();

    expect((await request(app).get('/fleet/workers')).status).toBe(401);
    expect(
      (await request(app).get('/fleet/workers').set(FLEET_API_KEY_HEADER, 'viewer-a')).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/fleet/tasks/route')
          .set(FLEET_API_KEY_HEADER, 'viewer-a')
          .send({ taskId: 'task-viewer' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/fleet/tasks/route')
          .set(FLEET_API_KEY_HEADER, 'operator-a')
          .send({ taskId: 'task-operator' })
      ).status,
    ).toBe(201);
  });

  it('derives the audit actor exclusively from the verified principal', async () => {
    server = secureServer();
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ taskId: 'task-approval', requiresApproval: true });

    const approved = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/approve`)
      .set(FLEET_API_KEY_HEADER, 'approver-a')
      .send({ actor: 'spoofed-admin' });
    expect(approved.status).toBe(200);

    const audit = await request(app)
      .get('/fleet/audit')
      .set(FLEET_API_KEY_HEADER, 'approver-a')
      .query({ runId: routed.body.run.id });
    expect(audit.body.at(-1)).toMatchObject({ action: 'run-approved', actor: 'approver-a' });
    expect(audit.body.map((entry: { actor?: string }) => entry.actor)).not.toContain(
      'spoofed-admin',
    );
  });

  it('rejects cross-tenant routing and hides runs and audit entries across tenants', async () => {
    server = secureServer();
    const app = server.getExpressApp();

    const deniedRoute = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ taskId: 'task-cross-tenant', tenantId: 'tenant-b' });
    expect(deniedRoute.status).toBe(403);

    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ taskId: 'task-tenant-a' });
    expect(routed.body.run).toMatchObject({
      tenantId: 'tenant-a',
      requestedByPrincipalId: 'operator-a',
    });

    const tenantBList = await request(app).get('/fleet/runs').set(FLEET_API_KEY_HEADER, 'viewer-b');
    expect(tenantBList.body).toEqual([]);

    expect(
      (
        await request(app)
          .get(`/fleet/runs/${routed.body.run.id}`)
          .set(FLEET_API_KEY_HEADER, 'viewer-b')
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/fleet/audit')
          .set(FLEET_API_KEY_HEADER, 'viewer-b')
          .query({ runId: routed.body.run.id })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/fleet/runs/${routed.body.run.id}`)
          .set(FLEET_API_KEY_HEADER, 'admin')
      ).status,
    ).toBe(200);
  });

  it('constrains administrator routing to the explicitly selected tenant', async () => {
    const tenantAWorker = candidate({
      worker: {
        ...candidate().worker,
        workerId: 'worker-a',
        tenants: ['tenant-a'],
      },
    });
    const tenantBWorker = candidate({
      worker: {
        ...candidate().worker,
        workerId: 'worker-b',
        tenants: ['tenant-b'],
      },
    });
    server = secureServer({
      directory: new StaticWorkerDirectory([tenantAWorker, tenantBWorker]),
    });

    const routed = await request(server.getExpressApp())
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'admin')
      .send({ taskId: 'task-tenant-b', tenantId: 'tenant-b' });

    expect(routed.status).toBe(201);
    expect(routed.body.run).toMatchObject({ workerId: 'worker-b', tenantId: 'tenant-b' });
  });

  it('prevents high-risk self-approval by default', async () => {
    server = secureServer();
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'dual-a')
      .send({ taskId: 'task-publish', riskLevel: 'publish' });

    const approved = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/approve`)
      .set(FLEET_API_KEY_HEADER, 'dual-a')
      .send({});
    expect(approved.status).toBe(403);
  });

  it('allows high-risk self-approval only when the policy explicitly enables it', async () => {
    server = secureServer({
      directory: new StaticWorkerDirectory([candidate()]),
      security: { mode: 'production', allowHighRiskSelfApproval: true },
    });
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'dual-a')
      .send({ taskId: 'task-publish', riskLevel: 'publish' });

    const approved = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/approve`)
      .set(FLEET_API_KEY_HEADER, 'dual-a')
      .send({});
    expect(approved.status).toBe(200);
  });

  it('makes concurrent approval and rejection resolve to one terminal decision', async () => {
    server = secureServer();
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ taskId: 'task-race', requiresApproval: true });
    const runId = routed.body.run.id;

    const [approve, reject] = await Promise.all([
      request(app)
        .post(`/fleet/runs/${runId}/approve`)
        .set(FLEET_API_KEY_HEADER, 'approver-a')
        .send({}),
      request(app)
        .post(`/fleet/runs/${runId}/reject`)
        .set(FLEET_API_KEY_HEADER, 'approver-2-a')
        .send({ reason: 'race decision' }),
    ]);

    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
    const finalRun = await request(app)
      .get(`/fleet/runs/${runId}`)
      .set(FLEET_API_KEY_HEADER, 'viewer-a');
    expect(['APPROVED', 'REJECTED']).toContain(finalRun.body.approvalState);
  });

  it('allows only the assigned worker principal to complete a run', async () => {
    server = secureServer();
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ taskId: 'task-worker' });

    const wrongWorker = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/complete`)
      .set(FLEET_API_KEY_HEADER, 'wrong-worker-a')
      .send({ status: 'COMPLETED' });
    expect(wrongWorker.status).toBe(403);

    const unboundScopedPrincipal = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/complete`)
      .set(FLEET_API_KEY_HEADER, 'complete-scope-a')
      .send({ status: 'COMPLETED' });
    expect(unboundScopedPrincipal.status).toBe(403);

    const assignedWorker = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/complete`)
      .set(FLEET_API_KEY_HEADER, 'worker-a')
      .send({ status: 'COMPLETED' });
    expect(assignedWorker.status).toBe(200);
  });

  it('declares and enforces a permission on every privileged route', async () => {
    server = secureServer();
    const app = server.getExpressApp();
    const requests = [
      request(app).get('/fleet/workers'),
      request(app).post('/fleet/tasks/route').send({ taskId: 'denied-route' }),
      request(app).get('/fleet/runs'),
      request(app).get('/fleet/runs/unknown'),
      request(app).get('/fleet/runs/unknown/artifacts'),
      request(app).post('/fleet/runs/unknown/approve').send({}),
      request(app).post('/fleet/runs/unknown/reject').send({}),
      request(app).post('/fleet/runs/unknown/complete').send({ status: 'COMPLETED' }),
      request(app).post('/fleet/runs/unknown/cancel').send({}),
      request(app).get('/fleet/audit'),
      request(app).get('/fleet/events'),
    ];

    const responses = await Promise.all(
      requests.map((pendingRequest) => pendingRequest.set(FLEET_API_KEY_HEADER, 'unprivileged-a')),
    );
    expect(responses.map((response) => response.status)).toEqual(new Array(11).fill(403));
  });

  it('allows operators to cancel active runs and records their verified identity', async () => {
    server = secureServer();
    const app = server.getExpressApp();
    const routed = await request(app)
      .post('/fleet/tasks/route')
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ taskId: 'task-cancel' });

    const canceled = await request(app)
      .post(`/fleet/runs/${routed.body.run.id}/cancel`)
      .set(FLEET_API_KEY_HEADER, 'operator-a')
      .send({ reason: 'operator stopped run', actor: 'spoofed' });
    expect(canceled.body.status).toBe('CANCELED');

    const audit = await request(app)
      .get('/fleet/audit')
      .set(FLEET_API_KEY_HEADER, 'viewer-a')
      .query({ runId: routed.body.run.id });
    expect(audit.body.at(-1)).toMatchObject({ action: 'run-canceled', actor: 'operator-a' });
  });
});
