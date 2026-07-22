import type { CoveragePolicy, CoverageThresholds } from './coverage-policy.mjs';

export type CoverageMetrics = CoverageThresholds;

export interface CoverageCounter {
  covered: number;
  total: number;
  skipped?: number;
  pct?: number;
}

export interface CoverageSummaryEntry {
  statements: CoverageCounter;
  branches: CoverageCounter;
  functions: CoverageCounter;
  lines: CoverageCounter;
}

export interface CoverageReport {
  schemaVersion: number;
  generatedAt: string;
  aggregate: { metrics: CoverageMetrics; thresholds: CoverageThresholds };
  changedPackages: string[];
  packages: Array<{
    name: string;
    root: string;
    files: number;
    changed: boolean;
    metrics: CoverageMetrics;
    thresholds: CoverageThresholds;
  }>;
  criticalFiles: Array<{
    file: string;
    metrics: CoverageMetrics | null;
    thresholds: CoverageThresholds;
  }>;
  failures: string[];
}

export function buildCoverageReport(input: {
  policy: CoveragePolicy;
  summary: Record<string, CoverageSummaryEntry>;
  repositoryRoot?: string;
  changedFiles?: string[];
}): CoverageReport;
export function renderCoverageMarkdown(report: CoverageReport): string;
