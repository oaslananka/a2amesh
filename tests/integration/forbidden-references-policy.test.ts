import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];
const checker = new URL('../../scripts/check-forbidden-refs.mjs', import.meta.url);
const platformName = ['Hel', 'm'].join('');

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'a2a-forbidden-refs-'));
  tempRoots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });

  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }

  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

describe('forbidden reference policy', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('allows generated changelogs to preserve historical platform names', async () => {
    const root = await createFixture({
      'packages/registry/CHANGELOG.md': `# Changelog\n\n- Add production ${platformName} chart.\n`,
    });

    const result = spawnSync(process.execPath, [checker.pathname], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('continues rejecting platform references in maintained documentation', async () => {
    const root = await createFixture({
      'README.md': `# Project\n\nDeploy with ${platformName}.\n`,
    });

    const result = spawnSync(process.execPath, [checker.pathname], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`README.md: ${platformName.toLowerCase()}`);
  });
});
