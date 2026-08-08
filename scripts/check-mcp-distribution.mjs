import { createHash } from 'node:crypto';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCommandSync, runPnpmSync } from './check-utils.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mcpRequire = createRequire(new URL('../packages/mcp/package.json', import.meta.url));
function runCommand(file, args, options = {}) {
  return runCommandSync(file, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function runPnpm(args, options = {}) {
  return runPnpmSync(args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
}

function parsePackFilename(output, destination) {
  const payload = JSON.parse(output);
  const entry = Array.isArray(payload) ? payload[0] : payload;
  if (typeof entry?.filename !== 'string') throw new Error('pnpm pack did not report a filename');
  return resolve(destination, entry.filename);
}

async function packWorkspacePackage(directory, destination) {
  const output = runPnpm(['--dir', directory, 'pack', '--json', '--pack-destination', destination]);
  return parsePackFilename(output, destination);
}

function fileDependency(from, tarball) {
  const path = relative(from, tarball).split('\\').join('/');
  return `file:${path.startsWith('.') ? path : `./${path}`}`;
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort((left, right) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}

async function digestTree(root) {
  const hash = createHash('sha256');
  for (const path of await listFiles(root)) {
    hash.update(relative(root, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function replaceDirectory(source, destination) {
  const next = `${destination}.next`;
  await rm(next, { recursive: true, force: true });
  await cp(source, next, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(next, destination, { recursive: true });
  await rm(next, { recursive: true, force: true });
}

function adjacentPrereleaseVersion(version, delta) {
  let start = version.length;
  while (start > 0) {
    const code = version.charCodeAt(start - 1);
    if (code < 48 || code > 57) break;
    start -= 1;
  }
  if (start === version.length) throw new Error(`cannot derive adjacent version from ${version}`);
  const value = Number(version.slice(start)) + delta;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`cannot derive adjacent version from ${version}`);
  }
  return `${version.slice(0, start)}${value}`;
}

async function validatePackageDirectory(root, expectedVersion) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageJson.name !== '@a2amesh/mcp') throw new Error('installed package name differs');
  if (packageJson.version !== expectedVersion) throw new Error('installed package version differs');
  if (packageJson.bin?.['a2amesh-mcp'] !== 'bin/a2amesh-mcp.js') {
    throw new Error('installed package binary contract differs');
  }
  await stat(join(root, 'dist/server/cli.js'));
  await stat(join(root, 'dist/server/index.js'));
}

function minimalProcessEnvironment(extra = {}) {
  const inherited = {};
  for (const name of [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'ComSpec',
    'TMP',
    'TEMP',
    'TMPDIR',
  ]) {
    const value = process.env[name];
    if (value) inherited[name] = value;
  }
  return { ...inherited, ...extra };
}

function safeMcpEnvironment() {
  return minimalProcessEnvironment({
    A2AMESH_MCP_TENANT_ID: 'distribution-tenant',
    A2AMESH_MCP_AUDIENCE: 'urn:mcp:a2amesh',
    A2AMESH_MCP_CLIENT_ID: 'distribution-check',
    A2AMESH_MCP_SCOPES: 'a2a:agents:read,a2a:tasks:read',
    A2AMESH_MCP_READ_APPROVAL_ID: 'distribution-read-policy',
    A2AMESH_MCP_ALLOWED_TOOLS: 'a2a_discover,a2a_get_task',
    A2AMESH_MCP_AGENTS_JSON: JSON.stringify([
      {
        id: 'example-agent',
        name: 'Example Agent',
        description: 'Distribution lifecycle fixture.',
        url: 'https://agent.example.com',
      },
    ]),
    A2AMESH_MCP_ALLOW_LOCALHOST: '0',
    A2AMESH_MCP_ALLOW_PRIVATE_NETWORKS: '0',
  });
}

async function probeStdio(binary) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(mcpRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href),
    import(pathToFileURL(mcpRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href),
  ]);
  const transport = new StdioClientTransport({
    command: binary,
    args: ['--transport', 'stdio'],
    env: Object.fromEntries(
      Object.entries(safeMcpEnvironment()).filter((entry) => typeof entry[1] === 'string'),
    ),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'a2amesh-distribution-check', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    const expected = ['a2a_discover', 'a2a_get_task'];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error(`installed stdio tool set differs: ${JSON.stringify(names)}`);
    }
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function validateInstalledConsumer(consumer, expectedVersion) {
  const packageLink = join(consumer, 'node_modules/@a2amesh/mcp');
  const installedPackage = await realpath(packageLink);
  await validatePackageDirectory(installedPackage, expectedVersion);
  const binary = join(
    consumer,
    'node_modules/.bin',
    process.platform === 'win32' ? 'a2amesh-mcp.cmd' : 'a2amesh-mcp',
  );
  const help = runCommand(binary, ['--help'], {
    cwd: consumer,
    env: minimalProcessEnvironment({ NO_COLOR: '1' }),
  });
  if (!help.includes('Usage: a2amesh-mcp')) throw new Error('installed binary help differs');
  const reportedVersion = runCommand(binary, ['--version'], {
    cwd: consumer,
    env: minimalProcessEnvironment({ NO_COLOR: '1' }),
  }).trim();
  if (reportedVersion !== expectedVersion) throw new Error('installed binary version differs');
  await probeStdio(binary);
  return installedPackage;
}

export async function checkMcpDistribution() {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-mcp-distribution-'));
  try {
    const tarballs = join(root, 'tarballs');
    const consumer = join(root, 'consumer');
    const npmConsumer = join(root, 'npm-consumer');
    const lifecycle = join(root, 'lifecycle', 'installed');
    const backup = join(root, 'lifecycle', 'backup');
    const syntheticNext = join(root, 'lifecycle', 'next');
    await mkdir(tarballs, { recursive: true });
    await mkdir(consumer, { recursive: true });
    await mkdir(npmConsumer, { recursive: true });

    const protocolTarball = await packWorkspacePackage('packages/protocol', tarballs);
    const runtimeTarball = await packWorkspacePackage('packages/runtime', tarballs);
    const mcpTarball = await packWorkspacePackage('packages/mcp', tarballs);
    const sourcePackage = JSON.parse(await readFile('packages/mcp/package.json', 'utf8'));
    const version = sourcePackage.version;

    await writeFile(
      join(consumer, 'package.json'),
      `${JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: { '@a2amesh/mcp': fileDependency(consumer, mcpTarball) },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(consumer, 'pnpm-workspace.yaml'),
      `packages: []\noverrides:\n  "@a2amesh/protocol": "${fileDependency(consumer, protocolTarball)}"\n  "@a2amesh/runtime": "${fileDependency(consumer, runtimeTarball)}"\n`,
    );
    runPnpm(['--dir', consumer, 'install', '--ignore-scripts']);

    const installedPackage = await validateInstalledConsumer(consumer, version);

    await writeFile(
      join(npmConsumer, 'package.json'),
      `${JSON.stringify(
        {
          private: true,
          type: 'module',
          dependencies: {
            '@a2amesh/protocol': fileDependency(npmConsumer, protocolTarball),
            '@a2amesh/runtime': fileDependency(npmConsumer, runtimeTarball),
            '@a2amesh/mcp': fileDependency(npmConsumer, mcpTarball),
          },
        },
        null,
        2,
      )}
`,
    );
    runCommand(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: npmConsumer },
    );
    await validateInstalledConsumer(npmConsumer, version);

    await cp(installedPackage, lifecycle, { recursive: true });
    await cp(lifecycle, backup, { recursive: true });
    const originalDigest = await digestTree(lifecycle);

    await cp(lifecycle, syntheticNext, { recursive: true });
    const nextVersion = adjacentPrereleaseVersion(version, 1);
    const nextManifestPath = join(syntheticNext, 'package.json');
    const nextManifest = JSON.parse(await readFile(nextManifestPath, 'utf8'));
    nextManifest.version = nextVersion;
    await writeFile(nextManifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    await writeFile(join(syntheticNext, 'lifecycle-marker.txt'), 'synthetic upgrade fixture\n');
    await replaceDirectory(syntheticNext, lifecycle);
    await validatePackageDirectory(lifecycle, nextVersion);
    await replaceDirectory(backup, lifecycle);
    await validatePackageDirectory(lifecycle, version);
    if ((await digestTree(lifecycle)) !== originalDigest) {
      throw new Error('rollback did not restore the original packed artifact');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkMcpDistribution();
  console.log('Standalone MCP distribution validation passed.');
}
