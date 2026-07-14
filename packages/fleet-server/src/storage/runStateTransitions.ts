import type {
  FleetRunPatch,
  FleetRunRecord,
  FleetRunTransitionCondition,
} from './IFleetStorage.js';

export function matchesRunTargetState(run: FleetRunRecord, patch: FleetRunPatch): boolean {
  const hasTargetState = patch.status !== undefined || patch.approvalState !== undefined;
  return (
    hasTargetState &&
    (patch.status === undefined || run.status === patch.status) &&
    (patch.approvalState === undefined || run.approvalState === patch.approvalState)
  );
}

export function matchesRunExpectedState(
  run: FleetRunRecord,
  expected: FleetRunTransitionCondition,
): boolean {
  return (
    (expected.status === undefined || run.status === expected.status) &&
    (expected.approvalState === undefined || run.approvalState === expected.approvalState)
  );
}
