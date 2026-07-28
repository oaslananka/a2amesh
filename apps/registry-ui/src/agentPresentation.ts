import type { RegisteredAgent } from './api/registry';

export type AgentFreshnessState = 'current' | 'stale' | 'never' | 'unknown';
export type AgentTrustPresentationState = 'trusted' | 'unverified' | 'rejected' | 'missing';

export interface AgentSignalPresentation<State extends string> {
  state: State;
  label: string;
  detail: string;
}

export function describeAgentFreshness(
  agent: RegisteredAgent,
  staleAfterMs: number,
  now = Date.now(),
): AgentSignalPresentation<AgentFreshnessState> {
  const timestamps = [agent.health?.checkedAt, agent.lastHeartbeatAt]
    .filter((value): value is string => Boolean(value))
    .map(Date.parse)
    .filter(Number.isFinite);

  if (timestamps.length === 0) {
    return {
      state: 'never',
      label: 'No health observation',
      detail: 'The registry has not recorded a heartbeat or structured health check.',
    };
  }

  const lastObservedAt = Math.max(...timestamps);
  const ageMs = now - lastObservedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return {
      state: 'unknown',
      label: 'Health time unknown',
      detail: 'The latest health timestamp cannot be compared with the current clock.',
    };
  }

  if (ageMs > staleAfterMs) {
    return {
      state: 'stale',
      label: 'Stale health data',
      detail: `The latest health observation is older than ${formatDuration(staleAfterMs)}.`,
    };
  }

  return {
    state: 'current',
    label: 'Current health data',
    detail: `The latest health observation is within ${formatDuration(staleAfterMs)}.`,
  };
}

export function describeAgentTrust(
  agent: RegisteredAgent,
): AgentSignalPresentation<AgentTrustPresentationState> {
  const verification = agent.verification;
  if (!verification) {
    return {
      state: 'missing',
      label: 'No trust evidence',
      detail: 'The registry record does not include Agent Card verification metadata.',
    };
  }

  if (verification.state === 'trusted' && verification.valid) {
    return {
      state: 'trusted',
      label: 'Trusted Agent Card',
      detail: verification.keyId
        ? `Verified with key ${verification.keyId}.`
        : 'The Agent Card signature was verified by the registry.',
    };
  }

  if (verification.state === 'rejected') {
    return {
      state: 'rejected',
      label: 'Rejected Agent Card',
      detail: verification.failureReason ?? 'The Agent Card failed registry trust policy.',
    };
  }

  return {
    state: 'unverified',
    label: 'Unverified Agent Card',
    detail: verification.failureReason ?? 'The Agent Card has no verified signature evidence.',
  };
}

function formatDuration(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
