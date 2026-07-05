import type { FleetRoutingCandidate } from '../routing/TaskRouter.js';

/**
 * A source of routing candidates for `routeFleetTask`/`planFleetDispatchWaves`.
 * Callers resolve the current candidate set through this contract instead of
 * assembling the array inline, which lets the candidate source be swapped
 * (static list, registry-backed discovery, ...) without touching routing code.
 */
export interface FleetWorkerDirectory {
  /**
   * Returns the current candidate set. Implementations must never throw for
   * transient discovery failures; they should return their last known-good
   * set instead, matching the fail-closed default of `routeFleetTask`
   * (an empty or stale set simply yields no eligible worker).
   */
  listCandidates(): Promise<readonly FleetRoutingCandidate[]>;
}

/**
 * Wraps a fixed candidate array. This is the directory implicit in every
 * existing caller that builds a `FleetRoutingCandidate[]` by hand, kept as an
 * explicit type so call sites can depend on `FleetWorkerDirectory` uniformly.
 */
export class StaticWorkerDirectory implements FleetWorkerDirectory {
  constructor(private readonly candidates: readonly FleetRoutingCandidate[]) {}

  async listCandidates(): Promise<readonly FleetRoutingCandidate[]> {
    return this.candidates;
  }
}
