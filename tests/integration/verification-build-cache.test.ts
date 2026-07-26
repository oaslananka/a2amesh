import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../..');
const buildScript = path.join(repoRoot, 'scripts/build-tsc-package.mjs');
const temporaryDirectories: string[] = [];

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'a2amesh-build-cache-'));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, 'src'), { recursive: true });
  await writeFile(
    path.join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          declaration: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          target: 'ES2022',
          tsBuildInfoFile: 'node_modules/.cache/tsconfig.tsbuildinfo',
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(directory, 'src/index.ts'), "export const value = 'first';\n");
  return directory;
}

async function runBuild(directory: string, ...args: string[]) {
  await execFileAsync(process.execPath, [buildScript, ...args], {
    cwd: directory,
    env: process.env,
    timeout: 30_000,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('TypeScript package build cache', () => {
  it('does not rewrite emitted output when inputs are unchanged', async () => {
    const directory = await createFixture();
    const output = path.join(directory, 'dist/index.js');

    await runBuild(directory);
    const firstStat = await stat(output, { bigint: true });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await runBuild(directory);
    const secondStat = await stat(output, { bigint: true });

    expect(secondStat.mtimeNs).toBe(firstStat.mtimeNs);
    await expect(readFile(output, 'utf8')).resolves.toContain("value = 'first'");
  });
});

it('rebuilds when source inputs change and when clean mode is requested', async () => {
  const directory = await createFixture();
  const source = path.join(directory, 'src/index.ts');
  const output = path.join(directory, 'dist/index.js');

  await runBuild(directory);
  const firstStat = await stat(output, { bigint: true });

  await writeFile(source, "export const value = 'second';\n");
  await runBuild(directory);
  const changedStat = await stat(output, { bigint: true });
  expect(changedStat.mtimeNs).toBeGreaterThan(firstStat.mtimeNs);
  await expect(readFile(output, 'utf8')).resolves.toContain("value = 'second'");

  await new Promise((resolve) => setTimeout(resolve, 25));
  await runBuild(directory, '--clean');
  const cleanStat = await stat(output, { bigint: true });
  expect(cleanStat.mtimeNs).toBeGreaterThan(changedStat.mtimeNs);
});
