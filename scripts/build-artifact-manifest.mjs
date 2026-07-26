import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

function normalizePath(path) {
  return path.split('\\').join('/');
}

async function collectTree(root, directory, files) {
  if (!(await exists(directory))) return;
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTree(root, absolutePath, files);
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
}

async function collectWorkspaceArtifacts(root) {
  const files = [];
  for (const workspaceRootName of ['packages', 'apps', 'examples']) {
    const workspaceRoot = join(root, workspaceRootName);
    if (!(await exists(workspaceRoot))) continue;
    const workspaceEntries = await readdir(workspaceRoot, { withFileTypes: true });
    workspaceEntries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of workspaceEntries) {
      if (!entry.isDirectory()) continue;
      const workspace = join(workspaceRoot, entry.name);
      await collectTree(root, join(workspace, 'dist'), files);
      for (const buildInfoPath of [
        join(workspace, 'tsconfig.tsbuildinfo'),
        join(workspace, 'node_modules/.cache/tsconfig.tsbuildinfo'),
      ]) {
        if (await exists(buildInfoPath)) files.push(buildInfoPath);
      }
    }
  }
  return files.sort((left, right) =>
    normalizePath(relative(root, left)).localeCompare(normalizePath(relative(root, right))),
  );
}

async function createManifest(root) {
  const files = await collectWorkspaceArtifacts(root);
  const entries = [];
  for (const file of files) {
    const content = await readFile(file);
    entries.push({
      path: normalizePath(relative(root, file)),
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength,
    });
  }
  return { schemaVersion: 1, algorithm: 'sha256', files: entries };
}

function compareManifests(expected, actual) {
  const expectedByPath = new Map(expected.files.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.files.map((entry) => [entry.path, entry]));
  for (const path of expectedByPath.keys()) {
    if (!actualByPath.has(path))
      throw new Error(`Build artifact is missing expected file: ${path}`);
  }
  for (const path of actualByPath.keys()) {
    if (!expectedByPath.has(path))
      throw new Error(`Build artifact contains unexpected file: ${path}`);
  }
  for (const [path, expectedEntry] of expectedByPath) {
    const actualEntry = actualByPath.get(path);
    if (actualEntry.sha256 !== expectedEntry.sha256) {
      throw new Error(`Build artifact hash mismatch for ${path}`);
    }
    if (actualEntry.bytes !== expectedEntry.bytes) {
      throw new Error(`Build artifact size mismatch for ${path}`);
    }
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const args = process.argv.slice(2);
const root = resolve(optionValue(args, '--root') ?? repositoryRoot);
const writeTarget = optionValue(args, '--write');
const verifyTarget = optionValue(args, '--verify');
if (Boolean(writeTarget) === Boolean(verifyTarget)) {
  throw new Error('Specify exactly one of --write <manifest> or --verify <manifest>.');
}

if (writeTarget) {
  const manifestPath = isAbsolute(writeTarget) ? writeTarget : resolve(root, writeTarget);
  const manifest = await createManifest(root);
  if (manifest.files.length === 0) throw new Error('No workspace build artifacts were found.');
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${manifest.files.length} build artifact entries to ${manifestPath}.\n`,
  );
} else {
  const manifestPath = isAbsolute(verifyTarget) ? verifyTarget : resolve(root, verifyTarget);
  const expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    expected.schemaVersion !== 1 ||
    expected.algorithm !== 'sha256' ||
    !Array.isArray(expected.files)
  ) {
    throw new Error(`Unsupported build artifact manifest: ${manifestPath}`);
  }
  const actual = await createManifest(root);
  compareManifests(expected, actual);
  process.stdout.write(`Verified ${actual.files.length} build artifact entries.\n`);
}
