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
        'Codecov coverage action must be pinned to the approved commit SHA',
        'Codecov contexts must not be required while Sonar and local thresholds remain active',
      ]),
    );
  });
});
