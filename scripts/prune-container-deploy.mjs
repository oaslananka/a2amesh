#!/usr/bin/env node
import { lstat, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALLOWED_ROOT_ENTRIES = new Set(['LICENSE', 'NOTICE', 'dist', 'node_modules', 'package.json']);
const FORBIDDEN_RUNTIME_SUFFIXES = ['.d.ts', '.d.ts.map', '.map', '.tsbuildinfo'];
const FORBIDDEN_NODE_MODULE_ENTRIES = [
  '.cache',
  '.pnpm-store',
  '.pnpm-workspace-state-v1.json',
  '.modules.yaml',
];

function deployRootFor(component) {
  switch (component) {
    case 'runtime':
      return '/opt/a2amesh/runtime';
    case 'registry':
      return '/opt/a2amesh/registry';
    default:
      throw new Error(`Unsupported container deploy component: ${component}`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertDirectory(path, label) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

async function assertFile(path, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
}

async function removeRuntimeMetadata(directory) {
  if (!(await pathExists(directory))) return;

  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) return;
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
  await assertFile(join(deployRoot, 'package.json'), 'Container package manifest');
  await assertDirectory(join(deployRoot, 'dist'), 'Container dist directory');
  await assertDirectory(join(deployRoot, 'node_modules'), 'Container node_modules directory');

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

export async function pruneContainerDeploy(component) {
  const deployRoot = deployRootFor(component);
  await assertDirectory(deployRoot, 'Container deploy root');

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
  return deployRoot;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const component = process.argv[2];
  if (!component) {
    process.stderr.write('Usage: node scripts/prune-container-deploy.mjs <runtime|registry>\n');
    process.exit(2);
  }

  const deployRoot = await pruneContainerDeploy(component);
  process.stdout.write(`Pruned container deploy: ${deployRoot}\n`);
}
