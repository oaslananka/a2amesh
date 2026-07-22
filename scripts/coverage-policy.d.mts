export interface CoverageThresholds {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export interface CoveragePolicy {
  schemaVersion: number;
  aggregate: CoverageThresholds;
  packages: Record<string, { root: string; thresholds: CoverageThresholds }>;
  criticalFiles: Record<string, CoverageThresholds>;
  exclusions: Array<{ pattern: string; reason: string }>;
}

export const coveragePolicy: CoveragePolicy;
export const coverageIncludePatterns: string[];
export const coverageExcludePatterns: string[];
export const coverageGlobalThresholds: CoverageThresholds;
