import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateCodecovPolicy } from '../../scripts/check-codecov-config.mjs';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

describe('Codecov observability policy', () => {
  it('accepts the repository coverage, Test Analytics, and bundle-analysis contract', async () => {
    const [codecovYaml, ciWorkflow, packageJson, ruleset, bundleUploader, documentation] =
      await Promise.all([
        read('codecov.yml'),
        read('.github/workflows/ci.yml'),
        read('package.json'),
        read('.github/rulesets/main.json'),
        read('scripts/upload-codecov-bundles.mjs'),
        read('docs/development/codecov.md'),
      ]);

    expect(
      validateCodecovPolicy({
        codecovYaml,
        ciWorkflow,
        packageJson,
        ruleset,
        bundleUploader,
        documentation,
      }),
    ).toEqual([]);
  });

  it('rejects bundle uploads that race coverage registration', async () => {
    const [codecovYaml, ciWorkflow, packageJson, ruleset, bundleUploader, documentation] =
      await Promise.all([
        read('codecov.yml'),
        read('.github/workflows/ci.yml'),
        read('package.json'),
        read('.github/rulesets/main.json'),
        read('scripts/upload-codecov-bundles.mjs'),
        read('docs/development/codecov.md'),
      ]);
    const racingWorkflow = ciWorkflow.replace(
      'Upload unit coverage to Codecov',
      'Upload JavaScript bundle analysis to Codecov',
    );

    expect(
      validateCodecovPolicy({
        codecovYaml,
        ciWorkflow: racingWorkflow,
        packageJson,
        ruleset,
        bundleUploader,
        documentation,
      }),
    ).toContain('Bundle analysis must run after coverage and Test Analytics in CI / unit');
  });

  it('rejects blocking Codecov statuses and mutable action references', () => {
    const failures = validateCodecovPolicy({
      codecovYaml: `coverage:\n  status:\n    project:\n      default:\n        informational: false\n`,
      ciWorkflow: 'uses: codecov/codecov-action@v7',
      packageJson: '{}',
      ruleset: '{"required_status_checks":[{"context":"codecov/patch"}]}',
      bundleUploader: '',
      documentation: '',
    });

    expect(failures).toEqual(
      expect.arrayContaining([
        'Codecov project and patch statuses must remain informational',
        'Coverage and test-result uploads must use the approved Codecov action SHA',
        'The JUnit upload must declare the Codecov test_results report type',
        'Codecov contexts must not be required while Sonar and local thresholds remain active',
      ]),
    );
  });
});
