export interface DependencyFreshnessFinding {
  source: 'pnpm audit' | 'OSV' | 'Dependabot';
  package: string;
  severity: 'high' | 'critical';
  remediation: 'available' | 'not listed';
}

export interface DependencyFreshnessInputs {
  audit: unknown;
  osv: unknown;
  dependabot: unknown;
  auditExitCode: number;
  osvExitCode: number;
  observedAt?: string;
}

export interface DependencyFreshnessResult {
  exitCode: 0 | 1;
  findings: DependencyFreshnessFinding[];
  scannerFailures: string[];
  summary: string;
}

export function evaluateDependencyFreshness(
  inputs: DependencyFreshnessInputs,
): DependencyFreshnessResult;
