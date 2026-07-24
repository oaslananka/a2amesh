export type LiveInteropEcosystem = 'javascript' | 'python' | 'all';

export interface LiveInteropScenarioDefinition {
  id: string;
  ecosystem: Exclude<LiveInteropEcosystem, 'all'>;
  direction: string;
}

export interface LiveInteropRunnerOptions {
  check: boolean;
  ecosystem: LiveInteropEcosystem;
  report: string;
}

export interface LiveInteropScenarioResult extends LiveInteropScenarioDefinition {
  status: 'passed' | 'failed';
  durationMs: number;
  result?: unknown;
  error?: string;
}

export interface LiveInteropScenarioReport {
  schemaVersion: string;
  mode: 'live-sdk';
  status: 'passed' | 'failed';
  startedAt: string;
  completedAt: string;
  scenarios: LiveInteropScenarioResult[];
}

export const LIVE_INTEROP_SCENARIOS: readonly LiveInteropScenarioDefinition[];
export function parseLiveInteropArgs(argv: string[]): LiveInteropRunnerOptions;
export function selectLiveInteropScenarios(
  ecosystem: LiveInteropEcosystem,
): LiveInteropScenarioDefinition[];
export function runScenarioMatrix(options: {
  scenarios: LiveInteropScenarioDefinition[];
  executeScenario: (scenario: LiveInteropScenarioDefinition) => Promise<unknown>;
  secrets?: string[];
}): Promise<LiveInteropScenarioReport>;
