/**
 * @file run-consumer-smoke.mjs
 *
 * Consumer smoke test matrix runner.
 *
 * Builds the monorepo, packs all publishable packages into tarballs,
 * creates a fresh temporary project outside the monorepo, installs
 * from the tarballs, and exercises every consumer surface.
 *
 * Uses npm instead of pnpm for the consumer install to avoid pnpm
 * workspace resolution issues when pnpm-workspace.yaml exists in a
 * parent directory (pnpm v11 walks up the tree aggressively).
 *
 *   1. Server     – start A2AServer, send message/send JSON-RPC, verify response
 *   2. Client     – import & instantiate A2AClient, call sendMessage
 *   3. Registry   – start registry server, register & query agents
 *   4. CLI        – a2amesh --version, --help, agent validate --help
 *   5. Scaffolder – @a2amesh/create-a2amesh, verify output structure
 *   6. WS         – load @a2amesh/internal-transport-ws module
 *   7. gRPC       – load @a2amesh/internal-transport-grpc module
 *   8. MCP bridge – load @a2amesh/mcp module
 *
 * Each failure identifies which package and which surface.
 * Exit code = number of failed surfaces (0 = all pass).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/* ───────── helpers ───────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
function readPositiveInteger(name, fallback, maximum) {
  const rawValue = process.env[name] || String(fallback);
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
  return value;
}

const consumerInstallTimeoutMs = readPositiveInteger(
  'A2AMESH_CONSUMER_INSTALL_TIMEOUT_MS',
  process.platform === 'win32' ? 480_000 : 300_000,
  900_000,
);
const consumerInstallAttempts = readPositiveInteger('A2AMESH_CONSUMER_INSTALL_ATTEMPTS', 2, 3);
const TRANSIENT_NPM_INSTALL_PATTERN =
  /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ERR_SOCKET_TIMEOUT|fetch failed|network timeout|network request|503 Service Unavailable|504 Gateway Timeout/i;

function run(cmd, args, opts = {}) {
  // On Windows, batch files (.cmd, .bat) and bare commands that resolve to
  // batch files (pnpm, npm, etc.) must run via cmd /c. Real executables like
  // process.execPath (node.exe) run fine directly.
  if (process.platform === 'win32') {
    return execFileSync('cmd', ['/c', cmd, ...args], {
      stdio: 'pipe',
      encoding: 'utf-8',
      ...opts,
    });
  }
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function runNode(args, opts = {}) {
  // process.execPath is always a real .exe — no cmd /c needed
  return execFileSync(process.execPath, args, { stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function runPnpm(args, opts = {}) {
  return run('pnpm', args, opts);
}

function formatInstallDiagnostics(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const boundedOutput = output.length > 4_000 ? output.slice(-4_000) : output;
  const errorCode = result.error?.code ? ` code=${result.error.code}` : '';
  const status = result.status === null ? '' : ` status=${result.status}`;
  const signal = result.signal ? ` signal=${result.signal}` : '';
  return `npm install failed${errorCode}${status}${signal}${boundedOutput ? `\n${boundedOutput}` : ``}`;
}

function isTransientInstallFailure(result) {
  if (result.error?.code === 'ETIMEDOUT') return true;
  return TRANSIENT_NPM_INSTALL_PATTERN.test(
    [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'),
  );
}

async function installConsumerDependencies(cwd) {
  const npmArgs = [
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    '--prefer-offline',
  ];
  const command = process.platform === 'win32' ? 'cmd' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/c', 'npm', ...npmArgs] : npmArgs;
  const env = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fetch_retries: '5',
    npm_config_fetch_retry_maxtimeout: '60000',
    npm_config_fetch_retry_mintimeout: '10000',
    npm_config_fund: 'false',
    npm_config_prefer_offline: 'true',
  };

  for (let attempt = 1; attempt <= consumerInstallAttempts; attempt += 1) {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf-8',
      env,
      stdio: 'pipe',
      timeout: consumerInstallTimeoutMs,
    });
    if (!result.error && result.status === 0) return;

    const diagnostics = formatInstallDiagnostics(result);
    const retryable = isTransientInstallFailure(result);
    if (!retryable || attempt === consumerInstallAttempts) {
      throw new Error(diagnostics, { cause: result.error });
    }

    console.warn(
      `  npm install attempt ${attempt}/${consumerInstallAttempts} hit a transient network failure; retrying.`,
    );
    console.warn(diagnostics);
    rmSync(join(cwd, 'node_modules'), { force: true, recursive: true });
    await new Promise((resolve_) => setTimeout(resolve_, 5_000));
  }
}

function getFreePort() {
  return new Promise((resolve_, reject_) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve_(port));
    });
    srv.on('error', reject_);
  });
}

function now() {
  return new Date().toISOString().slice(11, 19);
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/* ───────── package inventory ───────── */

const PACKAGES = [
  { name: '@a2amesh/protocol', dir: 'packages/protocol' },
  { name: '@a2amesh/internal-auth', dir: 'packages/auth' },
  { name: '@a2amesh/internal-telemetry', dir: 'packages/telemetry' },
  { name: '@a2amesh/runtime', dir: 'packages/runtime' },
  { name: '@a2amesh/registry', dir: 'packages/registry' },
  { name: '@a2amesh/cli', dir: 'packages/cli' },
  { name: '@a2amesh/create-a2amesh', dir: 'packages/create-a2amesh' },
  { name: '@a2amesh/internal-transport-ws', dir: 'packages/transport-ws' },
  { name: '@a2amesh/internal-transport-grpc', dir: 'packages/transport-grpc' },
  { name: '@a2amesh/mcp', dir: 'packages/mcp' },
];

/* ───────── step 1: build monorepo ───────── */

console.log(`[${now()}] === [consumer-smoke] Build monorepo ===`);
runPnpm(['run', 'build'], { cwd: root });

/* ───────── step 2: pack all packages ───────── */

console.log(`[${now()}] === [consumer-smoke] Pack packages ===`);
const packDir = mkdtempSync(join(tmpdir(), 'a2a-consumer-pack-'));

const tarballs = {};
for (const { name, dir } of PACKAGES) {
  const pkgDir = join(root, dir);
  runPnpm(['pack', '--pack-destination', packDir], { cwd: pkgDir });
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
  const version = pkgJson.version;
  // pnpm pack produces: <scope-without-@>-<name>-<version>.tgz
  const fileName = name.startsWith('@')
    ? `${name.slice(1).replace('/', '-')}-${version}.tgz`
    : `${name}-${version}.tgz`;
  const tgz = join(packDir, fileName);
  tarballs[name] = tgz;
  console.log(`  packed ${name} \u2192 ${fileName}`);
}

/* ───────── step 3: create temp project ───────── */

console.log(`[${now()}] === [consumer-smoke] Create temp project ===`);
const tempDir = mkdtempSync(join(tmpdir(), 'a2a-consumer-test-'));

const deps = {};
for (const [name, tgzPath] of Object.entries(tarballs)) {
  // Convert backslashes to forward slashes so JSON embedding is safe
  deps[name] = `file:${tgzPath.replace(/\\/g, '/')}`;
}
writeFileSync(
  join(tempDir, 'package.json'),
  JSON.stringify(
    {
      name: 'a2a-consumer-smoke',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: deps,
    },
    null,
    2,
  ),
);

console.log(`  installing in ${tempDir}`);
// Use npm for consumer install — pnpm v11 aggressively resolves workspace
// membership from file: deps on this machine (C:\Users\Admin\pnpm-workspace.yaml).
// npm's file: handling is simpler and cross-platform consistent.
await installConsumerDependencies(tempDir);
console.log('  install complete');

/* ───────── step 4: run smoke surfaces ───────── */

const results = [];
let testIndex = 0;

/**
 * Run a smoke test surface.
 *
 * @param {string} name  Display name for the surface
 * @param {string} code  Body of the test (no import lines — those are prepended)
 */
async function surf(name, code) {
  testIndex++;
  const file = `test-${testIndex}.mjs`;
  const fullCode = [
    'import assert from "node:assert";',
    'import { describe, it } from "node:test";',
    code,
  ].join('\n');
  writeFileSync(join(tempDir, file), fullCode);

  process.stdout.write(`  [smoke] ${name} ... `);
  try {
    runNode(['--test', file], { cwd: tempDir, timeout: 30000 });
    console.log(`${GREEN}PASS${RESET}`);
    results.push({ name, pass: true });
  } catch (err) {
    console.log(`${RED}FAIL${RESET}`);
    // node --test writes test output to stdout, not stderr
    const errorText = err.stderr || err.stdout || err.message || '';
    const lines = errorText.split('\n');
    const msg =
      lines
        .filter((l) => l.includes('throw') || l.includes('Error:') || l.includes('AssertionError'))
        .slice(-3)
        .join('\n')
        .trim() || lines.slice(-3).join('\n').trim();
    console.error(`    ${msg}`);
    results.push({ name, pass: false, error: msg });
  }
}

// ── Surface 1: Server ────────────────────────────────────────────
const srvPort = await getFreePort();
await surf(
  'server / A2AServer JSON-RPC sendTask',
  `
  const { A2AServer } = await import('@a2amesh/runtime');

  class TestServer extends A2AServer {
    async handleTask(task, message) {
      return [{ name: 'artifact', parts: [{ type: 'text', text: 'ack' }] }];
    }
  }

  const card = { protocolVersion: '1.0', name: 'smoke', description: 'test', url: 'http://localhost', version: '1.0.0' };
  const host = '127.0.0.1';
  const server = new TestServer(card, { allowLocalhost: true });
  await server.start(${srvPort}, host);

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
        messageId: 'msg-1',
        timestamp: new Date().toISOString(),
      },
    },
  });
  const resp = await fetch('http://' + host + ':' + ${srvPort} + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const data = await resp.json();
  await server.stop();

  assert.ok(data, 'No JSON-RPC response');
  assert.strictEqual(data.jsonrpc, '2.0', 'Not JSON-RPC 2.0');
  assert.ok(data.result, 'No result');
  assert.ok(data.result.id, 'No task id in result');
`,
);

// ── Surface 2: Client ────────────────────────────────────────────
const cliPort = await getFreePort();
await surf(
  'client / A2AClient sendMessage',
  `
  const { A2AServer, A2AClient } = await import('@a2amesh/runtime');

  class TestServer extends A2AServer {
    async handleTask(task, message) {
      return [{ name: 'artifact', parts: [{ type: 'text', text: 'pong' }] }];
    }
  }

  const card = { protocolVersion: '1.0', name: 'smoke', description: 'test', url: 'http://localhost', version: '1.0.0' };
  const host = '127.0.0.1';
  const srv = new TestServer(card, { allowLocalhost: true });
  await srv.start(${cliPort}, host);

  const client = new A2AClient('http://' + host + ':' + ${cliPort} + '/');
  const result = await client.sendMessage({
    message: {
      role: 'user',
      parts: [{ type: 'text', text: 'ping' }],
      messageId: 'msg-2',
      timestamp: new Date().toISOString(),
    },
  });
  await srv.stop();

  assert.ok(result, 'No result from client');
  assert.ok(result.id, 'No task id in result');
`,
);

// ── Surface 3: Registry ──────────────────────────────────────────
const regPort = await getFreePort();
await surf(
  'registry / RegistryServer agents API',
  `
  const { RegistryServer } = await import('@a2amesh/registry');
  const srv = new RegistryServer({ allowLocalhost: true });
  await srv.start(${regPort});

  const agentCard = {
    protocolVersion: '1.0',
    name: 'smoke-test',
    description: 'test',
    url: 'http://localhost:9999',
    version: '1.0.0',
    skills: [{ name: 'smoke', tags: ['smoke'] }],
  };
  const reg = await fetch('http://127.0.0.1:' + ${regPort} + '/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentUrl: 'http://localhost:9999', agentCard }),
  });
  assert.ok(reg.ok, 'Register failed: ' + reg.status);

  const q = await fetch('http://127.0.0.1:' + ${regPort} + '/agents/search?skill=smoke');
  const list = await q.json();
  assert.ok(Array.isArray(list), 'Agent list not array');
  assert.ok(list.length > 0, 'No agents found');

  const h = await fetch('http://127.0.0.1:' + ${regPort} + '/health');
  assert.ok(h.ok, 'Health check failed: ' + h.status);
  await srv.stop();
`,
);

// ── Surface 4: CLI ───────────────────────────────────────────────
await surf(
  'cli / a2amesh commands',
  `
  import { execFileSync } from 'node:child_process';
  import { fileURLToPath } from 'node:url';
  import { join } from 'node:path';

  const root = fileURLToPath(new URL('.', import.meta.url));
  const binDir = join(root, 'node_modules', '.bin');
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'cmd' : join(binDir, 'a2amesh');
  const binArgv = isWin ? ['/c', join(binDir, 'a2amesh.cmd')] : [];

  const version = execFileSync(bin, [...binArgv, '--version'], { encoding: 'utf-8' }).trim();
  assert.ok(version, 'No version output');

  const help = execFileSync(bin, [...binArgv, '--help'], { encoding: 'utf-8' });
  assert.ok(help.includes('Usage') || help.includes('Commands'), 'Help missing expected content');

  const validateHelp = execFileSync(bin, [...binArgv, 'agent', 'validate', '--help'], { encoding: 'utf-8', timeout: 10000 });
  assert.ok(validateHelp, 'agent validate --help produced no output');
`,
);

// ── Surface 5: Scaffolder ────────────────────────────────────────
const scaffDir = join(tempDir, 'scaff-test');
await surf(
  'scaffolder / @a2amesh/create-a2amesh scaffolding',
  `
  import { execFileSync } from 'node:child_process';
  import { existsSync, readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { join } from 'node:path';

  const root = fileURLToPath(new URL('.', import.meta.url));
  const binDir = join(root, 'node_modules', '.bin');
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'cmd' : join(binDir, 'create-a2amesh');
  const binArgv = isWin ? ['/c', join(binDir, 'create-a2amesh.cmd')] : [];
  const outDir = '${scaffDir.replace(/\\/g, '\\\\')}';
  execFileSync(bin, [...binArgv, outDir], { timeout: 30000 });

  assert.ok(existsSync(outDir + '/package.json'), 'package.json not created');
  const pj = JSON.parse(readFileSync(outDir + '/package.json', 'utf-8'));
  assert.ok(pj.name, 'Scaffolded project has no name');
  assert.ok(existsSync(outDir + '/src/index.ts') || existsSync(outDir + '/src/index.js'), 'src/index not created');
`,
);

// ── Surface 6: WS module load ────────────────────────────────────
await surf(
  'transport-ws / module loads and exports',
  `
  const mod = await import('@a2amesh/internal-transport-ws');
  assert.ok(mod.WsServer, 'Missing WsServer export');
  assert.ok(mod.WsClient, 'Missing WsClient export');
`,
);

// ── Surface 7: gRPC module load ──────────────────────────────────
await surf(
  'transport-grpc / module loads and exports',
  `
  const mod = await import('@a2amesh/internal-transport-grpc');
  assert.ok(mod.GrpcServer, 'Missing GrpcServer export');
  assert.ok(mod.GrpcClient, 'Missing GrpcClient export');
`,
);

// ── Surface 8: MCP bridge module load ────────────────────────────
await surf(
  'bridge-mcp / module loads and exports',
  `
  const mod = await import('@a2amesh/mcp');
  assert.ok(mod.createMcpToolFromAgent, 'Missing createMcpToolFromAgent export');
  assert.ok(mod.createA2ASkillFromMcpTool, 'Missing createA2ASkillFromMcpTool export');
`,
);

/* ───────── summary ───────── */

console.log(`\n[${now()}] === [consumer-smoke] Results ===`);
let passed = 0;
let failed = 0;
for (const r of results) {
  const icon = r.pass ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
  console.log(`  ${icon} ${r.name}`);
  if (r.pass) passed++;
  else failed++;
}

const total = results.length;
console.log(`\n  ${passed}/${total} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error('Consumer smoke test FAILURES detected.');
  process.exit(1);
}
