import type { WorkerCard } from '../types/domain.js';
import type { FleetRoutingCandidate } from '../routing/TaskRouter.js';
import type { FleetWorkerDirectory } from './WorkerDirectory.js';

/**
 * The shape this directory needs from a registered agent record. It matches
 * (a subset of) `RegisteredAgent` from `@a2amesh/runtime`'s
 * `AgentRegistryClient.listAgents()` structurally, so a real registry client
 * can be passed as a `RegistryDiscoverySource` with no adapter code and no
 * new workspace dependency on `@a2amesh/runtime` from this package.
 */
export interface RegistryDiscoveredAgent {
  id: string;
  card: WorkerCard;
  status: 'healthy' | 'unhealthy' | 'unknown';
  skills: readonly string[];
  tenantId?: string;
  registeredAt?: string;
  lastHeartbeatAt?: string;
}

export interface RegistryDiscoverySource {
  listAgents(): Promise<readonly RegistryDiscoveredAgent[]>;
}

export interface RegistryWorkerDirectoryOptions {
  /** Minimum time between registry queries; cached candidates are reused within this window. Defaults to 5000ms. */
  refreshIntervalMs?: number;
  /** An agent whose `lastHeartbeatAt` is older than this is treated as stale and evicted from the candidate set. Defaults to 60000ms. */
  staleAfterMs?: number;
  /** Reports current in-flight run counts per worker id, used to populate `FleetRoutingCandidate.activeRunCount`. Workers absent from the map are treated as idle (0). */
  activeRunCounts?: () => ReadonlyMap<string, number>;
  /** Candidate set to serve until the registry has been reached successfully at least once. Defaults to an empty array (fail closed). */
  fallback?: readonly FleetRoutingCandidate[];
  now?: () => Date;
}

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 60_000;

/**
 * Registry-backed candidate source for `routeFleetTask`/`planFleetDispatchWaves`
 * (closes the fleet gap tracked in `docs/fleet/roadmap.md`: the quickstart's
 * in-memory candidate array replaced with live discovery). Polls a
 * `RegistryDiscoverySource` on a bounded interval, evicts unhealthy or
 * stale-heartbeat agents, and falls back to the last known-good candidate
 * set (or a configured static fallback) when the registry is unreachable —
 * a transient registry outage degrades routing to stale data instead of
 * throwing.
 */
export class RegistryWorkerDirectory implements FleetWorkerDirectory {
  private cache: readonly FleetRoutingCandidate[];
  private lastRefreshAt = -Infinity;
  private readonly refreshIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly source: RegistryDiscoverySource,
    private readonly options: RegistryWorkerDirectoryOptions = {},
  ) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.now = options.now ?? (() => new Date());
    this.cache = options.fallback ?? [];
  }

  async listCandidates(): Promise<readonly FleetRoutingCandidate[]> {
    const nowMs = this.now().getTime();
    if (nowMs - this.lastRefreshAt >= this.refreshIntervalMs) {
      await this.refresh(nowMs);
    }
    return this.cache;
  }

  /** Forces the next `listCandidates` call to query the registry, ignoring the refresh interval. */
  invalidate(): void {
    this.lastRefreshAt = -Infinity;
  }

  private async refresh(nowMs: number): Promise<void> {
    try {
      const agents = await this.source.listAgents();
      const activeRunCounts = this.options.activeRunCounts?.() ?? new Map<string, number>();
      this.cache = agents
        .filter((agent) => this.isEligible(agent, nowMs))
        .map((agent) => toCandidate(agent, activeRunCounts));
    } catch {
      // Registry unreachable: keep serving the last known-good cache (or the
      // configured fallback, on the very first attempt) rather than
      // throwing, so a transient registry outage does not stop routing.
    } finally {
      this.lastRefreshAt = nowMs;
    }
  }

  private isEligible(agent: RegistryDiscoveredAgent, nowMs: number): boolean {
    if (agent.status === 'unhealthy') return false;
    if (!agent.lastHeartbeatAt) return true;
    const ageMs = nowMs - new Date(agent.lastHeartbeatAt).getTime();
    return Number.isFinite(ageMs) && ageMs <= this.staleAfterMs;
  }
}

function toCandidate(
  agent: RegistryDiscoveredAgent,
  activeRunCounts: ReadonlyMap<string, number>,
): FleetRoutingCandidate {
  const seenAt = agent.lastHeartbeatAt ?? agent.registeredAt ?? new Date().toISOString();
  return {
    worker: {
      workerId: agent.id,
      card: agent.card,
      discoveredAt: agent.registeredAt ?? seenAt,
      lastHeartbeatAt: seenAt,
      // The registry only distinguishes healthy/unhealthy/unknown (unhealthy
      // is filtered out before this runs); it has no BUSY concept of its
      // own, so actual load is enforced by routeFleetTask's concurrency
      // filter via `activeRunCount`/`maxConcurrentTasks` below, not by this
      // status field.
      status: 'IDLE',
      capabilities: agent.skills,
      roles: agent.card.fleetRoles ?? [],
      ...(agent.tenantId ? { tenants: [agent.tenantId] } : {}),
    },
    activeRunCount: activeRunCounts.get(agent.id) ?? 0,
    ...(agent.card.maxConcurrentTasks !== undefined
      ? { maxConcurrentTasks: agent.card.maxConcurrentTasks }
      : {}),
  };
}
