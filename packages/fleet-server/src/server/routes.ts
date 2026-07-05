/**
 * @file routes.ts
 * Fleet control-plane HTTP routes: live worker health, task routing (with an
 * operator approval queue for gated side effects), run status, artifact
 * review, and an append-only audit timeline. See
 * `docs/architecture/adr/0012-fleet-control-plane-server.md` for the design
 * rationale.
 */

import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  routeFleetTask,
  validateFleetArtifact,
  FleetArtifactValidationError,
  type FleetArtifactRecord,
  type FleetSideEffectLevel,
} from '@a2amesh/internal-fleet';
import type { FleetRunRecord } from '../storage/IFleetStorage.js';
import { HIGH_RISK_LEVELS, type FleetServerContext } from './types.js';

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message } });
}

function isFleetSideEffectLevel(value: unknown): value is FleetSideEffectLevel {
  return (
    typeof value === 'string' &&
    ['read-only', 'local-write', 'remote-write', 'publish', 'deploy'].includes(value)
  );
}

/**
 * Fleet-server's own bookkeeping of runs it has dispatched is the
 * authoritative concurrency signal, regardless of which
 * `FleetWorkerDirectory` implementation is configured (a directly injected
 * `StaticWorkerDirectory`, for example, has no way to know about runs this
 * server created).
 */
async function listCandidatesWithLiveRunCounts(context: FleetServerContext) {
  const candidates = await context.directory.listCandidates();
  return candidates.map((candidate) => ({
    ...candidate,
    activeRunCount:
      context.activeRunCounts.get(candidate.worker.workerId) ?? candidate.activeRunCount,
  }));
}

interface RouteTaskRequestBody {
  taskId?: string;
  requiredCapabilities?: string[];
  workspaceScope?: string;
  riskLevel?: string;
  requiresApproval?: boolean;
  tenantId?: string;
}

export function registerFleetRoutes(app: Express, context: FleetServerContext): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/fleet/workers', async (_req, res) => {
    const candidates = await listCandidatesWithLiveRunCounts(context);
    res.json(
      candidates.map((candidate) => ({
        workerId: candidate.worker.workerId,
        name: candidate.worker.card.name,
        status: candidate.worker.status,
        capabilities: candidate.worker.capabilities,
        roles: candidate.worker.roles,
        tenants: candidate.worker.tenants,
        lastHeartbeatAt: candidate.worker.lastHeartbeatAt,
        activeRunCount: candidate.activeRunCount,
        maxConcurrentTasks: candidate.maxConcurrentTasks,
      })),
    );
  });

  app.post('/fleet/tasks/route', async (req: Request, res: Response) => {
    const body = req.body as RouteTaskRequestBody;
    if (!body.taskId || typeof body.taskId !== 'string') {
      sendError(res, 400, 'taskId is required');
      return;
    }
    if (body.riskLevel !== undefined && !isFleetSideEffectLevel(body.riskLevel)) {
      sendError(res, 400, `invalid riskLevel "${String(body.riskLevel)}"`);
      return;
    }

    const candidates = await listCandidatesWithLiveRunCounts(context);
    const decision = routeFleetTask(
      {
        taskId: body.taskId,
        ...(body.requiredCapabilities ? { requiredCapabilities: body.requiredCapabilities } : {}),
        ...(body.workspaceScope ? { workspaceScope: body.workspaceScope } : {}),
      },
      candidates,
      context.routingPolicy,
      body.tenantId ? { tenantId: body.tenantId, now: context.now } : { now: context.now },
    );

    if (!decision.selectedWorkerId) {
      res.json({ decision, run: null });
      return;
    }

    const riskLevel = body.riskLevel as FleetSideEffectLevel | undefined;
    const requiresApproval =
      body.requiresApproval === true ||
      (riskLevel !== undefined && HIGH_RISK_LEVELS.has(riskLevel));
    const now = context.now().toISOString();
    const run: FleetRunRecord = {
      id: randomUUID(),
      taskId: body.taskId,
      workerId: decision.selectedWorkerId,
      status: requiresApproval ? 'PENDING' : 'RUNNING',
      approvalState: requiresApproval ? 'PENDING' : 'NOT_REQUIRED',
      ...(riskLevel ? { riskLevel } : {}),
      routingDecision: decision,
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
    const created = await context.storage.createRun(run);

    if (!requiresApproval) {
      bumpActiveRunCount(context, created.workerId, 1);
    }

    await context.storage.appendAudit({
      timestamp: now,
      action: requiresApproval ? 'run-pending-approval' : 'task-routed',
      runId: created.id,
      taskId: created.taskId,
      detail: { workerId: created.workerId },
    });
    context.sse.broadcast('run-updated', created);

    res.status(201).json({ decision, run: created });
  });

  app.get('/fleet/runs', async (req: Request, res: Response) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const approvalState =
      typeof req.query['approvalState'] === 'string' ? req.query['approvalState'] : undefined;
    const runs = await context.storage.listRuns({
      ...(status ? { status: status as FleetRunRecord['status'] } : {}),
      ...(approvalState ? { approvalState: approvalState as FleetRunRecord['approvalState'] } : {}),
    });
    res.json(runs);
  });

  app.get('/fleet/runs/:id', async (req: Request, res: Response) => {
    const run = await context.storage.getRun(req.params['id'] as string);
    if (!run) {
      sendError(res, 404, `run "${req.params['id']}" not found`);
      return;
    }
    res.json(run);
  });

  app.get('/fleet/runs/:id/artifacts', async (req: Request, res: Response) => {
    const run = await context.storage.getRun(req.params['id'] as string);
    if (!run) {
      sendError(res, 404, `run "${req.params['id']}" not found`);
      return;
    }
    res.json(run.artifacts);
  });

  app.post('/fleet/runs/:id/approve', async (req: Request, res: Response) => {
    const runId = req.params['id'] as string;
    const run = await context.storage.getRun(runId);
    if (!run) {
      sendError(res, 404, `run "${runId}" not found`);
      return;
    }
    if (run.approvalState !== 'PENDING') {
      sendError(
        res,
        409,
        `run "${runId}" is not pending approval (approvalState=${run.approvalState})`,
      );
      return;
    }

    const actor = typeof req.body?.actor === 'string' ? req.body.actor : undefined;
    const now = context.now().toISOString();
    const updated = await context.storage.updateRun(runId, {
      approvalState: 'APPROVED',
      status: 'RUNNING',
      updatedAt: now,
    });
    bumpActiveRunCount(context, run.workerId, 1);
    await context.storage.appendAudit({
      timestamp: now,
      action: 'run-approved',
      runId,
      taskId: run.taskId,
      ...(actor ? { actor } : {}),
    });
    context.sse.broadcast('run-updated', updated);
    res.json(updated);
  });

  app.post('/fleet/runs/:id/reject', async (req: Request, res: Response) => {
    const runId = req.params['id'] as string;
    const run = await context.storage.getRun(runId);
    if (!run) {
      sendError(res, 404, `run "${runId}" not found`);
      return;
    }
    if (run.approvalState !== 'PENDING') {
      sendError(
        res,
        409,
        `run "${runId}" is not pending approval (approvalState=${run.approvalState})`,
      );
      return;
    }

    const actor = typeof req.body?.actor === 'string' ? req.body.actor : undefined;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const now = context.now().toISOString();
    const updated = await context.storage.updateRun(runId, {
      approvalState: 'REJECTED',
      status: 'FAILED',
      updatedAt: now,
      ...(reason ? { failureReason: reason } : {}),
    });
    await context.storage.appendAudit({
      timestamp: now,
      action: 'run-rejected',
      runId,
      taskId: run.taskId,
      ...(actor ? { actor } : {}),
      ...(reason ? { detail: { reason } } : {}),
    });
    context.sse.broadcast('run-updated', updated);
    res.json(updated);
  });

  app.post('/fleet/runs/:id/complete', async (req: Request, res: Response) => {
    const runId = req.params['id'] as string;
    const run = await context.storage.getRun(runId);
    if (!run) {
      sendError(res, 404, `run "${runId}" not found`);
      return;
    }
    if (run.status !== 'RUNNING') {
      sendError(res, 409, `run "${runId}" is not running (status=${run.status})`);
      return;
    }

    const body = req.body as {
      status?: string;
      artifacts?: FleetArtifactRecord[];
      failureReason?: string;
    };
    if (body.status !== 'COMPLETED' && body.status !== 'FAILED') {
      sendError(res, 400, 'status must be "COMPLETED" or "FAILED"');
      return;
    }

    const now = context.now().toISOString();
    for (const artifact of body.artifacts ?? []) {
      try {
        validateFleetArtifact(artifact);
      } catch (error) {
        const message =
          error instanceof FleetArtifactValidationError ? error.message : String(error);
        sendError(res, 400, `invalid artifact "${artifact.artifactId}": ${message}`);
        return;
      }
    }
    for (const artifact of body.artifacts ?? []) {
      await context.storage.addArtifact(runId, artifact);
      await context.storage.appendAudit({
        timestamp: now,
        action: 'artifact-added',
        runId,
        taskId: run.taskId,
        detail: { artifactId: artifact.artifactId, kind: artifact.kind },
      });
    }

    const updated = await context.storage.updateRun(runId, {
      status: body.status,
      completedAt: now,
      updatedAt: now,
      ...(body.failureReason ? { failureReason: body.failureReason } : {}),
    });
    bumpActiveRunCount(context, run.workerId, -1);
    await context.storage.appendAudit({
      timestamp: now,
      action: body.status === 'COMPLETED' ? 'run-completed' : 'run-failed',
      runId,
      taskId: run.taskId,
    });
    context.sse.broadcast('run-updated', updated);
    res.json(updated);
  });

  app.get('/fleet/audit', async (req: Request, res: Response) => {
    const runId = typeof req.query['runId'] === 'string' ? req.query['runId'] : undefined;
    const limitRaw =
      typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : undefined;
    const entries = await context.storage.listAudit({
      ...(runId ? { runId } : {}),
      ...(limitRaw !== undefined && Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
    });
    res.json(entries);
  });

  app.get('/fleet/events', (req: Request, res: Response) => {
    context.sse.addClient(res);
    req.on('close', () => res.end());
  });
}

function bumpActiveRunCount(context: FleetServerContext, workerId: string, delta: number): void {
  const current = context.activeRunCounts.get(workerId) ?? 0;
  const next = Math.max(0, current + delta);
  if (next === 0) {
    context.activeRunCounts.delete(workerId);
  } else {
    context.activeRunCounts.set(workerId, next);
  }
}
