import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../../scripts/sync-dependency-policy.mjs', import.meta.url),
);
const tempRoots: string[] = [];

describe('dependency policy synchronizer', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('moves an existing version-specific release-age exception with a vulnerability fix', async () => {
    const workspace = await createWorkspace('js-yaml@4.3.0');
    const dataFile = await writeUpgradeData(workspace, [
      {
        depName: 'js-yaml',
        currentVersion: '4.3.0',
        newVersion: '4.3.1',
        isVulnerabilityAlert: 'true',
      },
    ]);

    await execSync(workspace, dataFile);

    const policy = await readFile(join(workspace, 'pnpm-workspace.yaml'), 'utf8');
    expect(policy).toContain('  - js-yaml@4.3.1');
    expect(policy).not.toContain('  - js-yaml@4.3.0');
  });

  it('reports a stale reviewed exception without mutating in check mode', async () => {
    const workspace = await createWorkspace('js-yaml@4.3.0');
    const dataFile = await writeUpgradeData(workspace, [
      {
        depName: 'js-yaml',
        currentVersion: '4.3.0',
        newVersion: '4.3.1',
        isVulnerabilityAlert: 'true',
      },
    ]);

    await expect(execCheck(workspace, dataFile)).rejects.toMatchObject({
      stderr: expect.stringContaining('reviewed release-age exception is stale'),
    });

    const policy = await readFile(join(workspace, 'pnpm-workspace.yaml'), 'utf8');
    expect(policy).toContain('  - js-yaml@4.3.0');
    expect(policy).not.toContain('  - js-yaml@4.3.1');
  });

  it('does not carry release-age exceptions into routine updates', async () => {
    const workspace = await createWorkspace('js-yaml@4.3.0');
    const dataFile = await writeUpgradeData(workspace, [
      {
        depName: 'js-yaml',
        currentVersion: '4.3.0',
        newVersion: '4.3.1',
        isVulnerabilityAlert: 'false',
      },
    ]);

    await execSync(workspace, dataFile);

    const policy = await readFile(join(workspace, 'pnpm-workspace.yaml'), 'utf8');
    expect(policy).toContain('  - js-yaml@4.3.0');
    expect(policy).not.toContain('  - js-yaml@4.3.1');
  });

  it('does not create a new release-age exception when none was reviewed before', async () => {
    const workspace = await createWorkspace('undici@7.29.0');
    const dataFile = await writeUpgradeData(workspace, [
      {
        depName: 'js-yaml',
        currentVersion: '4.3.0',
        newVersion: '4.3.1',
        isVulnerabilityAlert: 'true',
      },
    ]);

    await execSync(workspace, dataFile);

    const policy = await readFile(join(workspace, 'pnpm-workspace.yaml'), 'utf8');
    expect(policy).toContain('  - undici@7.29.0');
    expect(policy).not.toContain('js-yaml@');
  });
});

async function execCheck(workspace: string, dataFile: string) {
  return execFileAsync(process.execPath, [scriptPath], {
    cwd: workspace,
    env: {
      ...process.env,
      RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE: dataFile,
    },
  });
}

async function execSync(workspace: string, dataFile: string) {
  return execFileAsync(process.execPath, [scriptPath, '--write'], {
    cwd: workspace,
    env: {
      ...process.env,
      RENOVATE_POST_UPGRADE_COMMAND_DATA_FILE: dataFile,
    },
  });
}

async function createWorkspace(exclusion: string) {
  const workspace = await mkdtemp(join(tmpdir(), 'a2amesh-dependency-policy-'));
  tempRoots.push(workspace);
  await writeFixture(
    workspace,
    'pnpm-workspace.yaml',
    `packages:\n  - packages/*\n\nminimumReleaseAgeExclude:\n  - ${exclusion}\n`,
  );
  return workspace;
}

async function writeUpgradeData(workspace: string, upgrades: unknown[]) {
  const path = join(workspace, 'renovate-upgrades.json');
  await writeFile(path, `${JSON.stringify(upgrades)}\n`, 'utf8');
  return path;
}

async function writeFixture(root: string, path: string, contents: string) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}
