import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { format } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('../../scripts/repository-evidence.mjs', import.meta.url));
const tempRoots: string[] = [];
const packagePaths = [
  'packages/protocol',
  'packages/runtime',
  'packages/registry',
  'packages/mcp',
  'packages/cli',
  'packages/create-a2amesh',
];

describe.skipIf(process.platform === 'win32')('repository evidence CLI', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('fails check mode for deliberately stale repository metadata', async () => {
    const root = await createFixture('2026-01-01T00:00:00.000Z');
    const result = await runCli(root, ['--check', '--now', '2026-07-23T00:00:00.000Z']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Repository evidence is older than its 14-day refresh cadence');
  });

  it('writes a supplied live snapshot and then validates it without changes', async () => {
    const root = await createFixture('2026-01-01T00:00:00.000Z');
    const input = join(root, 'live-observation.json');
    await writeFile(input, JSON.stringify(createSnapshot('2026-07-23T21:05:00.000Z'), null, 2));

    const writeResult = await runCli(root, ['--write', '--input', input]);
    expect(writeResult.exitCode).toBe(0);

    const report = await readFile(join(root, 'docs/repo-maturity-report.md'), 'utf8');
    expect(report).toContain('Observed at **2026-07-23T21:05:00.000Z**');
    expect(report).toContain('[#202](https://github.com/oaslananka/a2amesh/pull/202)');
    expect(report).toBe(await format(report, { parser: 'markdown' }));

    const checkResult = await runCli(root, ['--check', '--now', '2026-07-24T00:00:00.000Z']);
    expect(checkResult.exitCode).toBe(0);
    expect(checkResult.stdout).toContain('Repository evidence validation passed.');
  });
});

async function createFixture(observedAt: string) {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-repository-evidence-'));
  tempRoots.push(root);
  await writeJson(
    join(root, '.release-please-manifest.json'),
    Object.fromEntries(packagePaths.map((path) => [path, '0.13.0-alpha.1'])),
  );
  await writeJson(join(root, 'release-please-config.json'), {
    packages: Object.fromEntries(
      packagePaths.map((path) => [path, { 'package-name': `@a2amesh/${path.split('/').at(-1)}` }]),
    ),
  });
  for (const path of packagePaths) {
    await writeJson(join(root, path, 'package.json'), {
      name: `@a2amesh/${path.split('/').at(-1)}`,
      version: '0.13.0-alpha.1',
    });
  }
  await writeJson(
    join(root, 'docs/governance/repository-evidence.json'),
    createSnapshot(observedAt),
  );
  await writeFile(
    join(root, 'docs/repo-maturity-report.md'),
    '# Maturity\n\n<!-- repository-evidence:start -->\nold\n<!-- repository-evidence:end -->\n\n## Narrative\n',
  );
  return root;
}

function createSnapshot(observedAt: string) {
  return {
    schema_version: 1,
    observed_at: observedAt,
    refresh_cadence_days: 14,
    repository: {
      name: 'oaslananka/a2amesh',
      url: 'https://github.com/oaslananka/a2amesh',
      default_branch: 'main',
      visibility: 'public',
      archived: false,
      license: 'Apache-2.0',
      open_work: { issues: 15, pull_requests: 1, total: 16 },
    },
    release: {
      source_version: '0.13.0-alpha.1',
      package_paths: packagePaths,
      latest_github_release: null,
      latest_canonical_tag: {
        name: '@a2amesh/runtime-v0.13.0-alpha.1',
        commit: '40500530522890f372599a20d35bfad77d94b546',
      },
      npm: {
        package: '@a2amesh/runtime',
        alpha: '0.13.0-alpha.1',
        latest: '0.1.0-alpha.1',
      },
      active_release_pr: {
        number: 202,
        title: 'chore: release main',
        url: 'https://github.com/oaslananka/a2amesh/pull/202',
        proposed_version: '0.14.0-alpha.1',
      },
    },
    settings: [
      {
        name: 'Private vulnerability reporting',
        value: 'enabled',
        owner: '@oaslananka',
        observed_at: '2026-07-23',
        refresh_cadence_days: 90,
        source: 'GitHub REST API: private-vulnerability-reporting',
      },
    ],
    provenance: {
      repository: 'GitHub REST API: GET /repos/oaslananka/a2amesh',
      issues: 'GitHub CLI: issue list --state open',
      pull_requests: 'GitHub CLI: pr list --state open',
      releases: 'GitHub REST API: releases/latest and tags',
      npm: 'npm registry metadata for @a2amesh/runtime',
      source_versions: '.release-please-manifest.json and release-tracked package.json files',
    },
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function runCli(root: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [scriptPath, '--root', root, ...args],
      {
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof result.code === 'number' ? result.code : 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
}
