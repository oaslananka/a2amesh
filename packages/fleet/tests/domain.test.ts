import { describe, it, expect } from 'vitest';
import type {
  FleetApprovalGate,
  FleetControlPlaneContract,
  FleetPolicyDecision,
  FleetSandboxProfile,
  FleetSideEffectBoundary,
  FleetWorkerRunAdmission,
  FleetRoutingDecision,
  FleetRoutingPolicy,
  FleetRun,
  FleetStrategy,
  FleetTask,
  FleetWorker,
  FleetWorkerDiscoveryRecord,
  WorkerCard,
} from '../src/types/domain.js';

const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

describe('Fleet Domain Types', () => {
  it('should support creating a WorkerCard', () => {
    const card: WorkerCard = {
      protocolVersion: '1.0',
      name: 'TestWorker',
      description: 'A test worker',
      url: 'http://localhost:8080',
      version: '1.0.0',
      fleetRoles: ['tester'],
      maxConcurrentTasks: 5,
    };
    expect(card.name).toBe('TestWorker');
    expect(card.maxConcurrentTasks).toBe(5);
  });

  it('should support creating a FleetWorker', () => {
    const worker: FleetWorker = {
      id: 'worker-1',
      card: {
        protocolVersion: '1.0',
        name: 'Worker1',
        description: 'First worker',
        url: 'http://worker1.local',
        version: '1.0.0',
      },
      status: 'IDLE',
      lastSeenAt: FIXED_TIMESTAMP,
    };
    expect(worker.id).toBe('worker-1');
    expect(worker.status).toBe('IDLE');
  });

  it('should support creating a FleetTask and FleetRun', () => {
    const task: FleetTask = {
      id: 'task-1',
      description: 'Run tests',
      status: {
        state: 'QUEUED',
        timestamp: FIXED_TIMESTAMP,
      },
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
    };

    const run: FleetRun = {
      id: 'run-1',
      taskId: task.id,
      workerId: 'worker-1',
      status: 'PENDING',
    };

    expect(task.id).toBe('task-1');
    expect(run.taskId).toBe('task-1');
  });

  it('should support creating a FleetStrategy', () => {
    const strategy: FleetStrategy = {
      type: 'ROUND_ROBIN',
      parameters: {
        timeout: 5000,
      },
    };
    expect(strategy.type).toBe('ROUND_ROBIN');
    expect(strategy.parameters?.['timeout']).toBe(5000);
  });
});

describe('Fleet control-plane architecture contracts', () => {
  it('captures worker discovery and routing inputs without executing provider-specific code', () => {
    const discoveryRecord = {
      workerId: 'worker-router-1',
      card: {
        protocolVersion: '1.0',
        name: 'RouterWorker',
        description: 'Handles routing fixtures',
        url: 'http://worker-router.local',
        version: '1.0.0',
        fleetRoles: ['router'],
        maxConcurrentTasks: 3,
      },
      discoveredAt: FIXED_TIMESTAMP,
      lastHeartbeatAt: FIXED_TIMESTAMP,
      status: 'IDLE',
      capabilities: ['code-review', 'test-execution'],
      roles: ['reviewer'],
      tenants: ['tenant-a'],
    } satisfies FleetWorkerDiscoveryRecord;

    const policy = {
      strategy: { type: 'CAPABILITY_MATCH' },
      requiredSignals: ['capability', 'tenant', 'availability', 'policy'],
      fallback: 'ROUTE_TO_ALTERNATE_WORKER',
      maxCandidateWorkers: 5,
      tenantScoped: true,
    } satisfies FleetRoutingPolicy;

    const decision = {
      taskId: 'task-review-1',
      selectedWorkerId: discoveryRecord.workerId,
      candidateWorkerIds: [discoveryRecord.workerId],
      signals: policy.requiredSignals,
      policy,
      reason: 'capability and tenant matched',
      decidedAt: FIXED_TIMESTAMP,
    } satisfies FleetRoutingDecision;

    expect(decision.selectedWorkerId).toBe('worker-router-1');
    expect(decision.policy.tenantScoped).toBe(true);
    expect(decision.signals).toEqual(['capability', 'tenant', 'availability', 'policy']);
  });

  it('defines fail-closed recovery behavior for post-1.0 Fleet control plane', () => {
    const contract = {
      version: 'post-1.0',
      responsibilities: [
        'worker-discovery',
        'capability-indexing',
        'routing-decision',
        'run-admission',
        'failure-classification',
        'human-handoff',
        'artifact-routing',
      ],
      routingPolicy: {
        strategy: { type: 'CAPABILITY_MATCH' },
        requiredSignals: ['capability', 'policy', 'availability'],
        fallback: 'FAIL_CLOSED',
        requiresHumanApproval: true,
      },
      failureHandling: [
        { failureClass: 'WORKER_UNAVAILABLE', action: 'ROUTE_TO_ALTERNATE_WORKER', retryable: true, maxAttempts: 2 },
        { failureClass: 'POLICY_DENIED', action: 'FAIL_CLOSED', retryable: false },
        {
          failureClass: 'HUMAN_APPROVAL_REQUIRED',
          action: 'REQUEST_HUMAN_APPROVAL',
          retryable: false,
          humanHandoffReason: 'side-effect boundary requires operator approval',
        },
      ],
      discoveryTtlSeconds: 30,
    } satisfies FleetControlPlaneContract;

    expect(contract.responsibilities).toContain('routing-decision');
    expect(contract.failureHandling).toContainEqual(
      expect.objectContaining({ failureClass: 'POLICY_DENIED', action: 'FAIL_CLOSED' }),
    );
    expect(contract.discoveryTtlSeconds).toBeGreaterThan(0);
  });
});


describe('Fleet policy, sandboxing, artifact, and approval boundaries', () => {
  const lockedSandbox = {
    isolation: 'container',
    network: 'allowlisted',
    filesystem: 'workspace-write',
    maxRuntimeSeconds: 900,
    allowedHosts: ['registry.local'],
    allowedCommands: ['pnpm test', 'pnpm build'],
    blockedCommands: ['git push', 'npm publish', 'kubectl apply'],
  } satisfies FleetSandboxProfile;

  it('admits read-only worker runs with sandbox and artifact limits', () => {
    const decision = {
      allowed: true,
      sideEffectLevel: 'read-only',
      sandbox: lockedSandbox,
      artifactPolicy: {
        sensitivity: 'internal',
        allowedArtifactTypes: ['log', 'test-report', 'coverage-summary'],
        maxArtifactBytes: 10_000_000,
        requireChecksum: true,
        requireRedaction: true,
        retentionDays: 14,
      },
      approval: {
        requiredFor: ['remote-write', 'publish', 'deploy'],
        state: 'NOT_REQUIRED',
      },
      evidence: ['policy:read-only', 'sandbox:container', 'artifact:redacted'],
    } satisfies FleetPolicyDecision;

    const admission = {
      taskId: 'task-safe-read',
      workerId: 'worker-1',
      decision,
      boundaries: [
        { level: 'read-only', requiresApproval: false, requiresAudit: true },
        { level: 'remote-write', requiresApproval: true, requiresAudit: true, forbiddenTargets: ['origin/main'] },
      ],
      admittedAt: FIXED_TIMESTAMP,
    } satisfies FleetWorkerRunAdmission;

    expect(admission.decision.allowed).toBe(true);
    expect(admission.decision.sandbox.blockedCommands).toContain('git push');
    expect(admission.decision.artifactPolicy.requireRedaction).toBe(true);
  });

  it('fails closed for high-impact side effects until approval is granted', () => {
    const pendingApproval = {
      requiredFor: ['remote-write', 'publish', 'deploy'],
      state: 'PENDING',
      reason: 'remote write requires operator approval',
      expiresAt: '2026-01-01T01:00:00.000Z',
    } satisfies FleetApprovalGate;

    const decision = {
      allowed: false,
      sideEffectLevel: 'remote-write',
      sandbox: lockedSandbox,
      artifactPolicy: {
        sensitivity: 'confidential',
        allowedArtifactTypes: ['diff', 'audit-log'],
        requireChecksum: true,
        requireRedaction: true,
      },
      approval: pendingApproval,
      denialReason: 'approval required before remote write',
      evidence: ['side-effect:remote-write', 'approval:pending'],
    } satisfies FleetPolicyDecision;

    const boundary = {
      level: 'remote-write',
      requiresApproval: true,
      requiresAudit: true,
      permittedCommands: ['git push'],
      forbiddenTargets: ['main', 'production'],
    } satisfies FleetSideEffectBoundary;

    expect(decision.allowed).toBe(false);
    expect(decision.approval.state).toBe('PENDING');
    expect(boundary.requiresApproval).toBe(true);
    expect(boundary.forbiddenTargets).toEqual(['main', 'production']);
  });
});
