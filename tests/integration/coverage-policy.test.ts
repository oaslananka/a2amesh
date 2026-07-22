import { describe, expect, it } from 'vitest';
import { validateCoveragePolicy } from '../../scripts/check-coverage-policy.mjs';
import type { CoveragePolicy } from '../../scripts/coverage-policy.mjs';

const floor = { statements: 70, branches: 60, functions: 70, lines: 70 };

function validInput() {
  const policy: CoveragePolicy = {
    schemaVersion: 1,
    aggregate: floor,
    packages: {
      runtime: { root: 'packages/runtime/src', thresholds: floor },
    },
    criticalFiles: {
      'packages/runtime/src/security/url.ts': floor,
    },
    exclusions: [{ pattern: '**/*.d.ts', reason: 'Type declarations have no runtime behavior.' }],
  };
  return {
    policy,
    activePackages: ['runtime'],
    existingPaths: new Set(['packages/runtime/src', 'packages/runtime/src/security/url.ts']),
    vitestConfig: 'coverageIncludePatterns coverageExcludePatterns coverageGlobalThresholds',
    packageJson: {
      scripts: {
        'coverage:inventory:check': 'node scripts/check-coverage-policy.mjs',
        'coverage:report': 'node scripts/report-coverage.mjs',
        'test:coverage': 'pnpm run coverage:inventory:check && node scripts/run-unit-coverage.mjs',
        'test:coverage:ci':
          'pnpm run coverage:inventory:check && node scripts/run-unit-coverage.mjs',
      },
    },
    ciWorkflow:
      'Publish package coverage summary GITHUB_STEP_SUMMARY Upload package coverage report coverage/package-summary.json coverage/package-summary.md if-no-files-found: error',
  };
}

describe('coverage inventory policy', () => {
  it('accepts a complete package and artifact contract', () => {
    expect(validateCoveragePolicy(validInput())).toEqual([]);
  });

  it('rejects missing, stale, and nonexistent package roots', () => {
    const input = validInput();
    input.activePackages.push('mcp');
    input.policy.packages['stale'] = { root: 'packages/old/src', thresholds: floor };
    expect(validateCoveragePolicy(input)).toEqual(
      expect.arrayContaining([
        'Active package missing from coverage inventory: mcp',
        'Stale package in coverage inventory: stale',
        'Coverage root for stale must be packages/stale/src',
        'Coverage root does not exist: packages/old/src',
      ]),
    );
  });

  it('rejects untracked critical files and nonblocking thresholds', () => {
    const input = validInput();
    input.policy.aggregate.branches = 0;
    input.policy.criticalFiles['packages/unknown/src/index.ts'] = floor;
    expect(validateCoveragePolicy(input)).toEqual(
      expect.arrayContaining([
        'aggregate branches threshold must be between 1 and 100',
        'Critical coverage file does not exist: packages/unknown/src/index.ts',
        'Critical coverage file is outside the package inventory: packages/unknown/src/index.ts',
      ]),
    );
  });
});
