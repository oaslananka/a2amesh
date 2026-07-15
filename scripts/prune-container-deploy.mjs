#!/usr/bin/env node
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALLOWED_ROOT_ENTRIES = new Set(['LICENSE', 'NOTICE', 'dist', 'node_modules', 'package.json']);
const FORBIDDEN_RUNTIME_SUFFIXES = ['.d.ts', '.d.ts.map', '.map', '.tsbuildinfo'];
const FORBIDDEN_NODE_MODULE_ENTRIES = [
  '.cache',
  '.pnpm-store',
  '.pnpm-workspace-state-v1.json',
  '.modules.yaml',
];

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function removeRuntimeMetadata(directory) {
  if (!(await pathExists(directory))) return;

  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeRuntimeMetadata(path);
        return;
      }
      if (FORBIDDEN_RUNTIME_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        await rm(path, { force: true });
      }
    }),
  );
}

async function assertRuntimeLayout(deployRoot) {
  const required = ['package.json', 'dist', 'node_modules'];
  const missing = [];
  for (const entry of required) {
    if (!(await pathExists(join(deployRoot, entry)))) missing.push(entry);
  }
  if (missing.length > 0) {
    throw new Error(`Container deploy is missing required runtime entries: ${missing.join(', ')}`);
  }

  const distEntries = await readdir(join(deployRoot, 'dist'), { recursive: true });
  if (!distEntries.some((entry) => String(entry).endsWith('.js'))) {
    throw new Error('Container deploy does not contain compiled JavaScript in dist/.');
  }

  const unexpected = (await readdir(deployRoot)).filter(
    (entry) => !ALLOWED_ROOT_ENTRIES.has(entry),
  );
  if (unexpected.length > 0) {
    throw new Error(`Container deploy contains unexpected root entries: ${unexpected.join(', ')}`);
  }

  const runtimeEntries = await readdir(deployRoot, { recursive: true });
  const metadata = runtimeEntries.filter((entry) =>
    FORBIDDEN_RUNTIME_SUFFIXES.some((suffix) => String(entry).endsWith(suffix)),
  );
  if (metadata.length > 0) {
    throw new Error(
      `Container deploy contains runtime metadata: ${metadata.slice(0, 20).join(', ')}`,
    );
  }
}

export async function pruneContainerDeploy(inputPath) {
  const deployRoot = resolve(inputPath);
  if (deployRoot === '/' || basename(deployRoot) === '') {
    throw new Error(`Refusing to prune unsafe deploy path: ${deployRoot}`);
  }
  if (!(await pathExists(join(deployRoot, 'package.json')))) {
    throw new Error(`Not a package deploy directory: ${deployRoot}`);
  }

  for (const entry of await readdir(deployRoot)) {
    if (!ALLOWED_ROOT_ENTRIES.has(entry)) {
      await rm(join(deployRoot, entry), { recursive: true, force: true });
    }
  }

  await removeRuntimeMetadata(deployRoot);
  await rm(join(deployRoot, 'node_modules', '.pnpm', 'lock.yaml'), { force: true });
  for (const entry of FORBIDDEN_NODE_MODULE_ENTRIES) {
    await rm(join(deployRoot, 'node_modules', entry), { recursive: true, force: true });
  }

  await assertRuntimeLayout(deployRoot);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const deployRoot = process.argv[2];
  if (!deployRoot) {
    process.stderr.write('Usage: node scripts/prune-container-deploy.mjs <deploy-directory>\n');
    process.exit(2);
  }

  await pruneContainerDeploy(deployRoot);
  process.stdout.write(`Pruned container deploy: ${resolve(deployRoot)}\n`);
}
