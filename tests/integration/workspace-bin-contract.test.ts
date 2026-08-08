import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../../scripts/check-workspace-bin-contract.mjs', import.meta.url),
);
const tempRoots: string[] = [];

describe('prebuild workspace binary contract', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('accepts a committed executable launcher that exists before build', async () => {
    const root = await createPackageFixture('bin/example.js', true);
    await expect(runCheck(root)).resolves.toBeDefined();
  });

  it('rejects generated dist output as a workspace bin target even if it exists', async () => {
    const root = await createPackageFixture('dist/example.js', true);
    await expect(runCheck(root)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'must target a committed prebuild launcher, not generated dist output',
      ),
    });
  });

  it('rejects a declared bin target that is missing before build', async () => {
    const root = await createPackageFixture('bin/example.js', false);
    await expect(runCheck(root)).rejects.toMatchObject({
      stderr: expect.stringContaining('declared bin target bin/example.js is missing before build'),
    });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a non-executable launcher on POSIX',
    async () => {
      const root = await createPackageFixture('bin/example.js', true, 0o644);
      await expect(runCheck(root)).rejects.toMatchObject({
        stderr: expect.stringContaining('must be executable before build'),
      });
    },
  );
});

async function createPackageFixture(
  target: string,
  createTarget: boolean,
  mode = 0o755,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-bin-contract-'));
  tempRoots.push(root);
  const packageDir = join(root, 'packages/example');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    `${JSON.stringify({ name: '@a2amesh/example', version: '1.0.0', bin: { example: target } }, null, 2)}\n`,
  );
  if (createTarget) {
    const path = join(packageDir, target);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '#!/usr/bin/env node\nconsole.log("example");\n');
    await chmod(path, mode);
  }
  return root;
}

async function runCheck(cwd: string) {
  return execFileAsync('node', [scriptPath], { cwd });
}
