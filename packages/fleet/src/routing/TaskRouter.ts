import type {
  FleetRoutingDecision,
  FleetRoutingPolicy,
  FleetRoutingSignal,
  FleetSideEffectLevel,
  FleetWorkerDiscoveryRecord,
} from '../types/domain.js';

/**
 * A worker considered for routing, augmented with the operational state the
 * router needs but that does not belong on the discovery record itself
 * (current load, workspace coverage, and any risk levels an operator has
 * pre-approved for that worker).
 */
export interface FleetRoutingCandidate {
  worker: FleetWorkerDiscoveryRecord;
  /** Number of runs currently assigned to this worker. */
  activeRunCount: number;
  /** Concurrency ceiling for this worker; unlimited when omitted. */
  maxConcurrentTasks?: number;
  /** Workspaces/repositories this worker is permitted to operate in. Omit to allow any workspace. */
  workspaceScopes?: readonly string[];
  /** Side-effect levels an operator has pre-approved this worker to execute without a fresh approval gate. */
  approvedForRiskLevels?: readonly FleetSideEffectLevel[];
}

export interface FleetTaskRoutingRequest {
  taskId: string;
  requiredCapabilities?: readonly string[];
  workspaceScope?: string;
  riskLevel?: FleetSideEffectLevel;
  /** True when this task's side effects require an explicit approval before dispatch. */
  requiresApproval?: boolean;
}

const DEFAULT_SIGNALS: readonly FleetRoutingSignal[] = ['capability', 'availability', 'policy'];

/**
 * Deterministic, policy-aware single-task routing (#91). Filters candidates
 * by capability, workspace scope, tenant, concurrency, and risk/approval
 * requirements, then scores the remaining eligible workers to select one.
 * Never throws: an unroutable task is reported through the decision's
 * `reason` and empty `selectedWorkerId`, matching the fail-closed default in
 * `FleetControlPlaneContract`.
 */
export function routeFleetTask(
  request: FleetTaskRoutingRequest,
  candidates: readonly FleetRoutingCandidate[],
  policy: FleetRoutingPolicy,
  options: { tenantId?: string; now?: () => Date } = {},
): FleetRoutingDecision {
  const decidedAt = (options.now ?? (() => new Date()))().toISOString();
  const signals = policy.requiredSignals.length > 0 ? policy.requiredSignals : DEFAULT_SIGNALS;

  const reasons: string[] = [];
  let eligible = candidates.filter((candidate) => {
    if (candidate.worker.status === 'OFFLINE') return false;
    if (policy.tenantScoped && options.tenantId) {
      if (!candidate.worker.tenants?.includes(options.tenantId)) return false;
    }
    return true;
  });
  if (eligible.length < candidates.length) reasons.push('filtered offline/out-of-tenant workers');

  const requiredCapabilities = request.requiredCapabilities ?? [];
  if (requiredCapabilities.length > 0) {
    eligible = eligible.filter((candidate) =>
      requiredCapabilities.every((capability) =>
        candidate.worker.capabilities.includes(capability),
      ),
    );
    reasons.push(`required capabilities: ${requiredCapabilities.join(', ')}`);
  }

  if (request.workspaceScope) {
    eligible = eligible.filter(
      (candidate) =>
        candidate.workspaceScopes === undefined ||
        candidate.workspaceScopes.includes(request.workspaceScope as string),
    );
    reasons.push(`workspace scope: ${request.workspaceScope}`);
  }

  eligible = eligible.filter((candidate) => {
    const limit = candidate.maxConcurrentTasks ?? candidate.worker.card.maxConcurrentTasks;
    if (limit === undefined) return true;
    return candidate.activeRunCount < limit;
  });
  reasons.push('within concurrency limits');

  const needsApproval =
    request.requiresApproval === true ||
    policy.requiresHumanApproval === true ||
    (request.riskLevel !== undefined && HIGH_RISK_LEVELS.has(request.riskLevel));

  if (needsApproval && request.riskLevel !== undefined) {
    eligible = eligible.filter((candidate) =>
      candidate.approvedForRiskLevels?.includes(request.riskLevel as FleetSideEffectLevel),
    );
    reasons.push(`approval required for risk level: ${request.riskLevel}`);
  } else if (needsApproval) {
    // A risk level was not supplied but approval is mandated by policy: no
    // worker can satisfy this without an explicit risk classification.
    eligible = [];
    reasons.push('approval required but no risk level was classified');
  }

  if (eligible.length === 0) {
    return {
      taskId: request.taskId,
      candidateWorkerIds: [],
      signals,
      policy,
      reason: `no eligible worker available (${reasons.join('; ')})`,
      decidedAt,
    };
  }

  const capped =
    policy.maxCandidateWorkers !== undefined
      ? eligible.slice(0, policy.maxCandidateWorkers)
      : eligible;

  const ranked = [...capped].sort(
    (left, right) =>
      scoreCandidate(right) - scoreCandidate(left) ||
      left.worker.workerId.localeCompare(right.worker.workerId),
  );
  const selected = ranked[0];

  return {
    taskId: request.taskId,
    ...(selected !== undefined ? { selectedWorkerId: selected.worker.workerId } : {}),
    candidateWorkerIds: capped.map((candidate) => candidate.worker.workerId),
    signals,
    policy,
    reason:
      selected !== undefined
        ? `selected by capability match, load, and deterministic tie-break (${reasons.join('; ')})`
        : `no eligible worker available (${reasons.join('; ')})`,
    decidedAt,
  };
}

const HIGH_RISK_LEVELS = new Set<FleetSideEffectLevel>(['remote-write', 'publish', 'deploy']);

function scoreCandidate(candidate: FleetRoutingCandidate): number {
  const capacity =
    (candidate.maxConcurrentTasks ?? candidate.worker.card.maxConcurrentTasks ?? 1) -
    candidate.activeRunCount;
  const capabilityDepth = candidate.worker.capabilities.length;
  return capacity * 1000 + capabilityDepth;
}

export interface FleetDispatchTask {
  taskId: string;
  dependsOn?: readonly string[];
}

export interface FleetDispatchPlan {
  /** Ordered batches; tasks within a batch have no dependency on each other and may run in parallel. */
  waves: readonly (readonly string[])[];
}

export class FleetDispatchCycleError extends Error {
  constructor(readonly remainingTaskIds: readonly string[]) {
    super(`dependency-aware dispatch plan has a cycle among tasks: ${remainingTaskIds.join(', ')}`);
    this.name = 'FleetDispatchCycleError';
  }
}

/**
 * Builds a dependency-aware dispatch plan (#91) using a Kahn's-algorithm
 * topological sort: each "wave" is a batch of tasks whose dependencies are
 * already satisfied by prior waves and that can be dispatched in parallel.
 */
export function planFleetDispatchWaves(tasks: readonly FleetDispatchTask[]): FleetDispatchPlan {
  const remainingDependencies = new Map<string, Set<string>>();
  for (const task of tasks) {
    remainingDependencies.set(task.taskId, new Set(task.dependsOn ?? []));
  }

  const waves: string[][] = [];
  const done = new Set<string>();
  while (done.size < tasks.length) {
    const wave = [...remainingDependencies.entries()]
      .filter(([taskId, deps]) => !done.has(taskId) && [...deps].every((dep) => done.has(dep)))
      .map(([taskId]) => taskId)
      .sort();

    if (wave.length === 0) {
      const remaining = [...remainingDependencies.keys()].filter((taskId) => !done.has(taskId));
      throw new FleetDispatchCycleError(remaining);
    }

    for (const taskId of wave) done.add(taskId);
    waves.push(wave);
  }

  return { waves };
}
