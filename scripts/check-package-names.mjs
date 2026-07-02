import { readFileSync } from 'node:fs';
import { getWorkspacePackages, fail, readJson } from './check-utils.mjs';

const ROOT_VERSION = '0.1.0-alpha.0';
const MANIFEST = readJson('.release-please-manifest.json');
const PUBLIC_PACKAGES = new Map([
  ['packages/protocol/package.json', '@a2amesh/protocol'],
  ['packages/runtime/package.json', '@a2amesh/runtime'],
  ['packages/registry/package.json', '@a2amesh/registry'],
  ['packages/mcp/package.json', '@a2amesh/mcp'],
  ['packages/cli/package.json', '@a2amesh/cli'],
  ['packages/create-a2amesh/package.json', '@a2amesh/create-a2amesh'],
]);
const REQUIRED_KEYWORDS = ['a2a', 'a2amesh', 'a2a-mesh', 'agent-to-agent', 'agents'];

const packages = getWorkspacePackages();
const packageByPath = new Map(packages.map((entry) => [entry.path, entry.packageJson]));
const packageByName = new Map(
  packages.map((entry) => [entry.packageJson.name, entry.packageJson]).filter(([name]) => name),
);
const localNames = new Set(packages.map((entry) => entry.packageJson.name).filter(Boolean));
const failures = [];

const root = packageByPath.get('package.json');
if (!root) {
  failures.push('package.json: missing root manifest');
} else {
  if (root.name !== 'a2amesh-workspace') {
    failures.push(`package.json: expected name a2amesh-workspace, found ${String(root.name)}`);
  }
  if (root.version !== ROOT_VERSION) {
    failures.push(`package.json: expected version ${ROOT_VERSION}, found ${String(root.version)}`);
  }
  if (root.private !== true) failures.push('package.json: root workspace must be private');
}

for (const [path, expectedName] of PUBLIC_PACKAGES) {
  const manifest = packageByPath.get(path);
  if (!manifest) {
    failures.push(`${path}: missing approved public package`);
    continue;
  }
  if (manifest.name !== expectedName) {
    failures.push(`${path}: expected name ${expectedName}, found ${String(manifest.name)}`);
  }
  const pkgDir = path.replace(/\/package\.json$/, '');
  const expectedVersion = MANIFEST[pkgDir] ?? ROOT_VERSION;
  if (manifest.version !== expectedVersion) {
    failures.push(
      `${path}: expected version ${expectedVersion}, found ${String(manifest.version)}`,
    );
  }
  if (manifest.private === true)
    failures.push(`${path}: approved public package must not be private`);
  if (manifest.publishConfig?.access !== 'public') {
    failures.push(`${path}: publishConfig.access must be public`);
  }
  if (manifest.publishConfig?.provenance !== true) {
    failures.push(`${path}: publishConfig.provenance must be true`);
  }
  if (!manifest.description?.includes('A2A Mesh')) {
    failures.push(`${path}: description must use A2A Mesh`);
  }
  for (const keyword of REQUIRED_KEYWORDS) {
    if (!manifest.keywords?.includes(keyword)) failures.push(`${path}: missing keyword ${keyword}`);
  }
}

for (const { path, dir, packageJson: manifest } of packages) {
  if (path === 'package.json') continue;
  const expectedPublicName = PUBLIC_PACKAGES.get(path);
  const isPublishable = manifest.private !== true;

  if (expectedPublicName) {
    if (!isPublishable) failures.push(`${path}: approved public package is private`);
    for (const block of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(manifest[block] ?? {})) {
        if (packageByName.get(dependency)?.private === true) {
          failures.push(`${path}: public package must not depend on private package ${dependency}`);
        }
      }
    }
  } else {
    if (isPublishable) failures.push(`${path}: non-approved workspace must set private true`);
    if (manifest.publishConfig?.access === 'public') {
      failures.push(`${path}: internal workspace must not set publishConfig.access public`);
    }
  }

  const staleScopePattern = new RegExp('^@oaslananka\\/a2a-' + 'warp(?:-|$)', 'i');
  const staleBinPattern = new RegExp('a2a-' + 'warp', 'i');

  if (staleScopePattern.test(String(manifest.name))) {
    failures.push(`${path}: stale package name ${manifest.name}`);
  }
  for (const [binName] of Object.entries(manifest.bin ?? {})) {
    if (staleBinPattern.test(binName)) failures.push(`${path}: stale binary name ${binName}`);
  }
  for (const block of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const dependency of Object.keys(manifest[block] ?? {})) {
      if (staleScopePattern.test(dependency)) {
        failures.push(`${path}: stale dependency ${dependency}`);
      }
      if (
        (dependency.startsWith('@a2amesh/') || dependency === '@a2amesh/create-a2amesh') &&
        !localNames.has(dependency)
      ) {
        failures.push(`${path}: unknown local package dependency ${dependency}`);
      }
    }
  }
  if (dir === 'packages/cli' && Object.keys(manifest.bin ?? {}).join(',') !== 'a2amesh') {
    failures.push(`${path}: CLI binary must be exactly a2amesh`);
  }
  if (dir === 'packages/create-a2amesh' && manifest.name !== '@a2amesh/create-a2amesh') {
    failures.push(`${path}: scaffold package must be @a2amesh/create-a2amesh`);
  }
}

const publishableNames = packages
  .filter(({ path, packageJson }) => path !== 'package.json' && packageJson.private !== true)
  .map(({ packageJson }) => packageJson.name)
  .sort();
const expectedNames = [...PUBLIC_PACKAGES.values()].sort();
if (JSON.stringify(publishableNames) !== JSON.stringify(expectedNames)) {
  failures.push(
    `publishable package set must be exactly ${expectedNames.join(', ')}; found ${publishableNames.join(', ')}`,
  );
}

if (failures.length > 0) fail('Package name validation failed.', failures);
