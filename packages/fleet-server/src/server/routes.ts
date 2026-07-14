/**
 * @file routes.ts
 * Authenticated, authorized, tenant-scoped Fleet control-plane HTTP routes.
 */

import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  FleetArtifactValidationError,
  routeFleetTask,
  validateFleetArtifact,
  type FleetArtifactRecord,
  type FleetRoutingCandidate,
  type FleetSideEffectLevel,
} from '@a2amesh/internal-fleet';
import type { FleetRunRecord } from '../storage/IFleetStorage.js';
import {
  canAccessFleetTenant,
  getFleetPrincipal,
  requireFleetPermission,
  resolveFleetTenant,
  tenantStorageFilter,
  type FleetPrincipal,
} from './authorization.js';
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

async function listCandidatesWithLiveRunCounts(
  context: FleetServerContext,
  principal: FleetPrincipal,
  targetTenantId?: string,
): Promise<FleetRoutingCandidate[]> {
  const candidates = await context.directory.listCandidates();
  return candidates
    .filter((candidate) => canAccessCandidate(principal, candidate, targetTenantId))
    .map((candidate) => ({
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

  app.get('/fleet/workers', requireFleetPermission('fleet:workers:read'), async (req, res) => {
    const principal = getFleetPrincipal(req);
    const candidates = await listCandidatesWithLiveRunCounts(context, principal);
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

  app.post('/fleet/tasks/route', requireFleetPermission('fleet:runs:route'), async (req, res) => {
    const principal = getFleetPrincipal(req);
    const body = req.body as RouteTaskRequestBody;
    if (!body.taskId || typeof body.taskId !== 'string') {
      sendError(res, 400, 'taskId is required');
      return;
    }
    if (body.riskLevel !== undefined && !isFleetSideEffectLevel(body.riskLevel)) {
      sendError(res, 400, `invalid riskLevel "${String(body.riskLevel)}"`);
      return;
    }

    const tenant = resolveFleetTenant(principal, body.tenantId);
    if (!tenant.allowed) {
      sendError(res, 403, 'Cross-tenant task routing is not allowed');
      return;
    }

    const candidates = await listCandidatesWithLiveRunCounts(context, principal, tenant.tenantId);
    const decision = routeFleetTask(
      {
        taskId: body.taskId,
        ...(body.requiredCapabilities ? { requiredCapabilities: body.requiredCapabilities } : {}),
        ...(body.workspaceScope ? { workspaceScope: body.workspaceScope } : {}),
      },
      candidates,
      context.routingPolicy,
      tenant.tenantId ? { tenantId: tenant.tenantId, now: context.now } : { now: context.now },
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
      ...(tenant.tenantId ? { tenantId: tenant.tenantId } : {}),
      requestedByPrincipalId: principal.principalId,
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
      actor: principal.principalId,
      ...(created.tenantId ? { tenantId: created.tenantId } : {}),
      detail: { workerId: created.workerId },
    });
    broadcastRunUpdate(context, created);

    res.status(201).json({ decision, run: created });
  });

  app.get('/fleet/runs', requireFleetPermission('fleet:runs:read'), async (req, res) => {
    const principal = getFleetPrincipal(req);
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const approvalState =
      typeof req.query['approvalState'] === 'string' ? req.query['approvalState'] : undefined;
    const tenantId = tenantStorageFilter(principal);
    const runs = await context.storage.listRuns({
      ...(status ? { status: status as FleetRunRecord['status'] } : {}),
      ...(approvalState ? { approvalState: approvalState as FleetRunRecord['approvalState'] } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
    });
    res.json(runs);
  });

  app.get('/fleet/runs/:id', requireFleetPermission('fleet:runs:read'), async (req, res) => {
    const run = await getAccessibleRun(req, res, context);
    if (!run) return;
    res.json(run);
  });

  app.get(
    '/fleet/runs/:id/artifacts',
    requireFleetPermission('fleet:runs:read'),
    async (req, res) => {
      const run = await getAccessibleRun(req, res, context);
      if (!run) return;
      res.json(run.artifacts);
    },
  );

  app.post(
    '/fleet/runs/:id/approve',
    requireFleetPermission('fleet:runs:approve'),
    async (req, res) => {
      const principal = getFleetPrincipal(req);
      const run = await getAccessibleRun(req, res, context);
      if (!run) return;

      if (
        !context.allowHighRiskSelfApproval &&
        run.riskLevel !== undefined &&
        HIGH_RISK_LEVELS.has(run.riskLevel) &&
        run.requestedByPrincipalId === principal.principalId
      ) {
        sendError(res, 403, 'High-risk runs cannot be self-approved');
        return;
      }

      const now = context.now().toISOString();
      const transition = await context.storage.transitionRun(
        run.id,
        { status: 'PENDING', approvalState: 'PENDING' },
        { approvalState: 'APPROVED', status: 'RUNNING', updatedAt: now },
      );
      if (transition.outcome === 'unchanged') {
        res.json(transition.run);
        return;
      }
      if (transition.outcome !== 'updated') {
        sendTransitionConflict(res, run.id, transition);
        return;
      }

      bumpActiveRunCount(context, transition.run.workerId, 1);
      await context.storage.appendAudit({
        timestamp: now,
        action: 'run-approved',
        runId: transition.run.id,
        taskId: transition.run.taskId,
        actor: principal.principalId,
        ...(transition.run.tenantId ? { tenantId: transition.run.tenantId } : {}),
      });
      broadcastRunUpdate(context, transition.run);
      res.json(transition.run);
    },
  );

  app.post(
    '/fleet/runs/:id/reject',
    requireFleetPermission('fleet:runs:approve'),
    async (req, res) => {
      const principal = getFleetPrincipal(req);
      const run = await getAccessibleRun(req, res, context);
      if (!run) return;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const now = context.now().toISOString();
      const transition = await context.storage.transitionRun(
        run.id,
        { status: 'PENDING', approvalState: 'PENDING' },
        {
          approvalState: 'REJECTED',
          status: 'FAILED',
          updatedAt: now,
          ...(reason ? { failureReason: reason } : {}),
        },
      );
      if (transition.outcome === 'unchanged') {
        res.json(transition.run);
        return;
      }
      if (transition.outcome !== 'updated') {
        sendTransitionConflict(res, run.id, transition);
        return;
      }

      await context.storage.appendAudit({
        timestamp: now,
        action: 'run-rejected',
        runId: transition.run.id,
        taskId: transition.run.taskId,
        actor: principal.principalId,
        ...(transition.run.tenantId ? { tenantId: transition.run.tenantId } : {}),
        ...(reason ? { detail: { reason } } : {}),
      });
      broadcastRunUpdate(context, transition.run);
      res.json(transition.run);
    },
  );

  app.post(
    '/fleet/runs/:id/complete',
    requireFleetPermission('fleet:runs:complete'),
    async (req, res) => {
      const principal = getFleetPrincipal(req);
      const run = await getAccessibleRun(req, res, context);
      if (!run) return;
      if (!principal.roles.includes('administrator') && principal.workerId !== run.workerId) {
        sendError(res, 403, 'Worker principal is not assigned to this run');
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

      const now = context.now().toISOString();
      const transition = await context.storage.transitionRun(
        run.id,
        { status: 'RUNNING' },
        {
          status: body.status,
          artifacts: [...run.artifacts, ...(body.artifacts ?? [])],
          completedAt: now,
          updatedAt: now,
          ...(body.failureReason ? { failureReason: body.failureReason } : {}),
        },
      );
      if (transition.outcome !== 'updated') {
        sendTransitionConflict(res, run.id, transition);
        return;
      }

      for (const artifact of body.artifacts ?? []) {
        await context.storage.appendAudit({
          timestamp: now,
          action: 'artifact-added',
          runId: transition.run.id,
          taskId: transition.run.taskId,
          actor: principal.principalId,
          ...(transition.run.tenantId ? { tenantId: transition.run.tenantId } : {}),
          detail: { artifactId: artifact.artifactId, kind: artifact.kind },
        });
      }
      bumpActiveRunCount(context, transition.run.workerId, -1);
      await context.storage.appendAudit({
        timestamp: now,
        action: body.status === 'COMPLETED' ? 'run-completed' : 'run-failed',
        runId: transition.run.id,
        taskId: transition.run.taskId,
        actor: principal.principalId,
        ...(transition.run.tenantId ? { tenantId: transition.run.tenantId } : {}),
      });
      broadcastRunUpdate(context, transition.run);
      res.json(transition.run);
    },
  );

  app.post(
    '/fleet/runs/:id/cancel',
    requireFleetPermission('fleet:runs:cancel'),
    async (req, res) => {
      const principal = getFleetPrincipal(req);
      const run = await getAccessibleRun(req, res, context);
      if (!run) return;
      if (run.status !== 'PENDING' && run.status !== 'RUNNING') {
        sendError(res, 409, `run "${run.id}" cannot be canceled (status=${run.status})`);
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const now = context.now().toISOString();
      const transition = await context.storage.transitionRun(
        run.id,
        { status: run.status, approvalState: run.approvalState },
        {
          status: 'CANCELED',
          ...(run.approvalState === 'PENDING' ? { approvalState: 'EXPIRED' } : {}),
          completedAt: now,
          updatedAt: now,
          ...(reason ? { failureReason: reason } : {}),
        },
      );
      if (transition.outcome !== 'updated') {
        sendTransitionConflict(res, run.id, transition);
        return;
      }

      if (run.status === 'RUNNING') {
        bumpActiveRunCount(context, transition.run.workerId, -1);
      }
      await context.storage.appendAudit({
        timestamp: now,
        action: 'run-canceled',
        runId: transition.run.id,
        taskId: transition.run.taskId,
        actor: principal.principalId,
        ...(transition.run.tenantId ? { tenantId: transition.run.tenantId } : {}),
        ...(reason ? { detail: { reason } } : {}),
      });
      broadcastRunUpdate(context, transition.run);
      res.json(transition.run);
    },
  );

  app.get('/fleet/audit', requireFleetPermission('fleet:audit:read'), async (req, res) => {
    const principal = getFleetPrincipal(req);
    const runId = typeof req.query['runId'] === 'string' ? req.query['runId'] : undefined;
    if (runId) {
      const run = await context.storage.getRun(runId);
      if (!run || !canAccessFleetTenant(principal, run.tenantId)) {
        sendError(res, 404, `run "${runId}" not found`);
        return;
      }
    }
    const limitRaw =
      typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : undefined;
    const tenantId = tenantStorageFilter(principal);
    const entries = await context.storage.listAudit({
      ...(runId ? { runId } : {}),
      ...(limitRaw !== undefined && Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
    });
    res.json(entries);
  });

  app.get('/fleet/events', requireFleetPermission('fleet:events:read'), (req, res) => {
    const principal = getFleetPrincipal(req);
    context.sse.addClient(res, {
      ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
      allTenants: principal.canAccessAllTenants,
    });
    req.on('close', () => res.end());
  });
}

async function getAccessibleRun(
  req: Request,
  res: Response,
  context: FleetServerContext,
): Promise<FleetRunRecord | null> {
  const runId = req.params['id'] as string;
  const run = await context.storage.getRun(runId);
  const principal = getFleetPrincipal(req);
  if (!run || !canAccessFleetTenant(principal, run.tenantId)) {
    sendError(res, 404, `run "${runId}" not found`);
    return null;
  }
  return run;
}

function canAccessCandidate(
  principal: FleetPrincipal,
  candidate: FleetRoutingCandidate,
  targetTenantId?: string,
): boolean {
  const tenants = candidate.worker.tenants;
  if (!tenants || tenants.length === 0) return true;
  if (targetTenantId !== undefined) return tenants.includes(targetTenantId);
  if (principal.canAccessAllTenants) return true;
  return principal.tenantId !== undefined && tenants.includes(principal.tenantId);
}

function broadcastRunUpdate(context: FleetServerContext, run: FleetRunRecord): void {
  context.sse.broadcast('run-updated', run, {
    ...(run.tenantId ? { tenantId: run.tenantId } : {}),
  });
}

function sendTransitionConflict(
  res: Response,
  runId: string,
  transition: Awaited<ReturnType<FleetServerContext['storage']['transitionRun']>>,
): void {
  if (transition.outcome === 'not-found') {
    sendError(res, 404, `run "${runId}" not found`);
    return;
  }
  if (transition.outcome === 'unchanged') {
    sendError(res, 409, `run "${runId}" is already in the requested terminal state`);
    return;
  }
  sendError(
    res,
    409,
    `run "${runId}" state changed concurrently (status=${transition.run.status}, approvalState=${transition.run.approvalState})`,
  );
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
