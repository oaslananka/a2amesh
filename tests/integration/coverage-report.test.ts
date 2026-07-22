import { describe, expect, it } from 'vitest';
import { buildCoverageReport, renderCoverageMarkdown } from '../../scripts/report-coverage.mjs';
import type { CoveragePolicy } from '../../scripts/coverage-policy.mjs';

const thresholds = { statements: 75, branches: 50, functions: 75, lines: 75 };
const policy: CoveragePolicy = {
  schemaVersion: 1,
  aggregate: thresholds,
  packages: {
    runtime: { root: 'packages/runtime/src', thresholds },
  },
  criticalFiles: {
    'packages/runtime/src/security/url.ts': thresholds,
  },
  exclusions: [],
};

function metric(covered: number, total: number) {
  return { covered, total, skipped: 0, pct: total ? (covered / total) * 100 : 100 };
}

function fileCoverage(covered = 8, total = 10) {
  return {
    statements: metric(covered, total),
    branches: metric(covered, total),
    functions: metric(covered, total),
    lines: metric(covered, total),
  };
}

describe('package coverage report', () => {
  it('aggregates package and critical-file metrics from absolute paths', () => {
    const summary = {
      total: fileCoverage(),
      '/repo/packages/runtime/src/security/url.ts': fileCoverage(),
    };
    const report = buildCoverageReport({
      policy,
      summary,
      repositoryRoot: '/repo',
      changedFiles: ['packages/runtime/src/security/url.ts'],
    });
    expect(report.failures).toEqual([]);
    expect(report.changedPackages).toEqual(['runtime']);
    expect(report.packages[0]).toMatchObject({
      name: 'runtime',
      changed: true,
      files: 1,
      metrics: { statements: 80, branches: 80, functions: 80, lines: 80 },
    });
    const markdown = renderCoverageMarkdown(report);
    expect(markdown).toContain('| runtime | yes | 1 | 80.00% |');
    expect(markdown).not.toContain('\n\n\n');
    expect(markdown.endsWith('\n\n')).toBe(false);
  });

  it('labels threshold regressions in changed packages explicitly', () => {
    const report = buildCoverageReport({
      policy,
      summary: {
        total: fileCoverage(6, 10),
        '/repo/packages/runtime/src/security/url.ts': fileCoverage(6, 10),
      },
      repositoryRoot: '/repo',
      changedFiles: ['packages/runtime/src/security/url.ts'],
    });
    expect(report.failures).toContain(
      'changed package runtime statements coverage 60.00% is below 75.00%',
    );
  });

  it('reports missing package files and threshold regressions', () => {
    const report = buildCoverageReport({
      policy,
      summary: { total: fileCoverage(4, 10) },
      repositoryRoot: '/repo',
    });
    expect(report.failures).toEqual(
      expect.arrayContaining([
        'No coverage files were reported for package: runtime',
        'aggregate statements coverage 40.00% is below 75.00%',
        'Critical coverage file missing from report: packages/runtime/src/security/url.ts',
      ]),
    );
  });
});
