import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../..');
const manifestScript = path.join(repoRoot, 'scripts/build-artifact-manifest.mjs');
const temporaryDirectories: string[] = [];

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2amesh-build-manifest-'));
  temporaryDirectories.push(directory);
  const files = {
    'packages/runtime/dist/index.js': 'runtime-output\n',
    'packages/runtime/node_modules/.cache/tsconfig.tsbuildinfo': 'runtime-cache\n',
    'packages/runtime/src/index.ts': 'source-is-not-an-artifact\n',
    'apps/demo/dist/index.html': '<main>demo</main>\n',
    'docs-site/.vitepress/dist/index.html': '<main>docs</main>\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return directory;
}

async function runManifest(directory: string, mode: '--write' | '--verify', manifest: string) {
  return execFileAsync(process.execPath, [manifestScript, '--root', directory, mode, manifest], {
    cwd: repoRoot,
    env: process.env,
    timeout: 30_000,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('workspace build artifact manifest', () => {
  it('writes a sorted manifest for build outputs and verifies exact restored contents', async () => {
    const directory = await createFixture();
    const manifest = path.join(directory, '.artifacts/build/manifest.json');

    await runManifest(directory, '--write', manifest);
    const payload = JSON.parse(await readFile(manifest, 'utf8')) as {
      schemaVersion: number;
      algorithm: string;
      files: Array<{ path: string; sha256: string; bytes: number }>;
    };

    expect(payload.schemaVersion).toBe(1);
    expect(payload.algorithm).toBe('sha256');
    expect(payload.files.map((entry) => entry.path)).toEqual([
      'apps/demo/dist/index.html',
      'packages/runtime/dist/index.js',
      'packages/runtime/node_modules/.cache/tsconfig.tsbuildinfo',
    ]);
    expect(payload.files.some((entry) => entry.path.startsWith('docs-site/'))).toBe(false);
    expect(payload.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
    await expect(runManifest(directory, '--verify', manifest)).resolves.toBeDefined();

    await writeFile(path.join(directory, 'packages/runtime/dist/index.js'), 'tampered\n');
    await expect(runManifest(directory, '--verify', manifest)).rejects.toThrow(/hash mismatch/i);
  });

  it('rejects unmanifested build output files', async () => {
    const directory = await createFixture();
    const manifest = path.join(directory, '.artifacts/build/manifest.json');
    await runManifest(directory, '--write', manifest);

    await writeFile(path.join(directory, 'packages/runtime/dist/extra.js'), 'extra\n');
    await expect(runManifest(directory, '--verify', manifest)).rejects.toThrow(/unexpected/i);
  });
});
