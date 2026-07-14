import type {
  FleetRoutingPolicy,
  FleetWorkerDirectory,
  FleetSideEffectLevel,
} from '@a2amesh/internal-fleet';
import type { IFleetStorage } from '../storage/IFleetStorage.js';
import type { FleetSseController } from './sse.js';

export interface FleetServerContext {
  storage: IFleetStorage;
  directory: FleetWorkerDirectory;
  routingPolicy: FleetRoutingPolicy;
  sse: FleetSseController;
  activeRunCounts: Map<string, number>;
  now: () => Date;
  allowHighRiskSelfApproval: boolean;
}

export const HIGH_RISK_LEVELS: ReadonlySet<FleetSideEffectLevel> = new Set([
  'remote-write',
  'publish',
  'deploy',
]);
