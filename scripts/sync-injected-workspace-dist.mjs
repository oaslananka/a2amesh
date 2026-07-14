import { cp, lstat, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = join(repoRoot, 'packages');
const virtualStoreRoot = join(repoRoot, 'node_modules', '.pnpm');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readWorkspacePackages() {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageRoot = join(packagesRoot, entry.name);
    const packageJsonPath = join(packageRoot, 'package.json');
    if (!(await exists(packageJsonPath))) continue;

    const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) continue;

    const dist = join(packageRoot, 'dist');
    if (!(await exists(dist))) continue;
    packages.push({ name: manifest.name, root: packageRoot, dist });
  }

  return packages;
}

function packagePath(name) {
  return name.startsWith('@') ? name.split('/') : [name];
}

async function syncInjectedCopy(workspacePackage, candidate) {
  let candidateStats;
  try {
    candidateStats = await lstat(candidate);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }

  // Normal workspace dependencies are symlinks and already see the current dist output.
  if (!candidateStats.isDirectory() || candidateStats.isSymbolicLink()) return false;
  if ((await realpath(candidate)) === (await realpath(workspacePackage.root))) return false;

  const candidateManifest = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'));
  if (candidateManifest.name !== workspacePackage.name) return false;

  const destination = join(candidate, 'dist');
  await rm(destination, { recursive: true, force: true });
  await cp(workspacePackage.dist, destination, { recursive: true, force: true });
  return true;
}

async function main() {
  if (!(await exists(virtualStoreRoot))) {
    process.stdout.write('Injected workspace dist sync skipped: pnpm virtual store is absent.\n');
    return;
  }

  const workspacePackages = await readWorkspacePackages();
  const storeEntries = await readdir(virtualStoreRoot, { withFileTypes: true });
  let synced = 0;

  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory()) continue;
    const dependenciesRoot = join(virtualStoreRoot, storeEntry.name, 'node_modules');
    if (!(await exists(dependenciesRoot))) continue;

    for (const workspacePackage of workspacePackages) {
      const candidate = join(dependenciesRoot, ...packagePath(workspacePackage.name));
      if (await syncInjectedCopy(workspacePackage, candidate)) synced += 1;
    }
  }

  process.stdout.write(
    `Synced ${synced} injected workspace dist cop${synced === 1 ? 'y' : 'ies'}.\n`,
  );
}

await main();
