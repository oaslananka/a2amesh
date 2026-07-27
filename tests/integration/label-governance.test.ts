import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(path, repoRoot), 'utf8');
}

function captureValues(input: string, pattern: RegExp): string[] {
  return [...input.matchAll(pattern)].flatMap((match) =>
    typeof match[1] === 'string' ? [match[1]] : [],
  );
}

function declaredLabels(labelsYaml: string): Set<string> {
  return new Set(captureValues(labelsYaml, /^- name: ['"]([^'"]+)['"]$/gm));
}

function templateLabels(template: string): string[] {
  const rawLabels = template.match(/^labels:\s*\[([^\]]+)\]/m)?.[1];
  return rawLabels
    ? rawLabels.split(',').map((label) => label.trim().replace(/^['"]|['"]$/g, ''))
    : [];
}

describe('GitHub label governance', () => {
  it('uses one canonical structured taxonomy in every issue form', async () => {
    const labelsYaml = await readRepoFile('.github/labels.yml');
    const declared = declaredLabels(labelsYaml);
    const expectedByTemplate: Record<string, string[]> = {
      'adapter_request.yml': ['type:adapter', 'area:dx', 'status:triaged'],
      'bug_report.yml': ['type:bug', 'status:triaged'],
      'documentation.yml': ['type:docs', 'area:docs', 'status:triaged'],
      'feature_request.yml': ['type:feature', 'status:triaged'],
      'security_hardening.yml': ['type:security', 'area:security', 'status:triaged'],
    };

    for (const [file, expected] of Object.entries(expectedByTemplate)) {
      const template = await readRepoFile(`.github/ISSUE_TEMPLATE/${file}`);
      expect(templateLabels(template)).toEqual(expected);
      for (const label of expected) expect(declared.has(label)).toBe(true);
    }
  });

  it('declares every pull-request labeler key and uses singular canonical area names', async () => {
    const [labelsYaml, labeler] = await Promise.all([
      readRepoFile('.github/labels.yml'),
      readRepoFile('.github/labeler.yml'),
    ]);
    const declared = declaredLabels(labelsYaml);
    const labelerKeys = captureValues(labeler, /^'([^']+)':$/gm);

    for (const label of labelerKeys) expect(declared.has(label)).toBe(true);
    expect(labelerKeys).toContain('area:deployment');
    expect(labelerKeys).toContain('area:testing');
    expect(labelerKeys).not.toContain('area:deployments');
    expect(labelerKeys).not.toContain('area:tests');
  });

  it('does not reintroduce deprecated parallel taxonomy labels', async () => {
    const labelsYaml = await readRepoFile('.github/labels.yml');
    const declared = declaredLabels(labelsYaml);
    const deprecated = [
      'bug',
      'documentation',
      'enhancement',
      'adapter',
      'hardening',
      'triage',
      'question',
      'invalid',
      'wontfix',
      'area:devex',
      'area:tests',
      'area:deployments',
    ];

    for (const label of deprecated) expect(declared.has(label)).toBe(false);
  });

  it('documents the live taxonomy and provides an explicit apply-only sync command', async () => {
    const [taxonomy, checker, syncScript, packageJsonText] = await Promise.all([
      readRepoFile('docs/development/issue-taxonomy.md'),
      readRepoFile('scripts/check-labels.mjs'),
      readRepoFile('scripts/sync-github-labels.mjs'),
      readRepoFile('package.json'),
    ]);
    const packageJson = JSON.parse(packageJsonText) as { scripts: Record<string, string> };

    expect(taxonomy).toContain('Canonical source of truth');
    expect(taxonomy).toContain('`type:feature`');
    expect(taxonomy).toContain('`status:triaged`');
    expect(taxonomy).toContain('`pnpm run labels:check-live`');
    expect(checker).toContain('.github/labeler.yml');
    expect(checker).toContain('functional labels');
    expect(syncScript).toContain("process.argv.includes('--apply')");
    expect(syncScript).not.toContain("spawnSync('gh'");
    expect(syncScript).toContain("'/usr/bin/gh'");
    expect(syncScript).not.toContain('block.match');
    expect(packageJson.scripts['labels:check-live']).toContain('sync-github-labels.mjs');
    expect(packageJson.scripts['labels:apply']).toContain('--apply');
  });
});
