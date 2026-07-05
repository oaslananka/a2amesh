import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { StaticWorkerDirectory, type FleetRoutingCandidate } from '@a2amesh/internal-fleet';
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
