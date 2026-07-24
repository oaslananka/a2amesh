#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadLiveInteropManifest } from './live-interop/manifest.mjs';
import { startParticipant } from './live-interop/process.mjs';
import { redactDiagnostic, writeLiveInteropReport } from './live-interop/report.mjs';
import {
  parseLiveInteropArgs,
  runScenarioMatrix,
  selectLiveInteropScenarios,
} from './live-interop/runner.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const meshServer = path.join(root, 'tests/interop/live/mesh/server.mjs');
const meshClient = path.join(root, 'tests/interop/live/mesh/client.mjs');
const javascriptRoot = path.join(root, 'tests/interop/live/javascript');
const javascriptClient = path.join(javascriptRoot, 'client.mjs');
const javascriptServer = path.join(javascriptRoot, 'server.mjs');
const pythonRoot = path.join(root, 'tests/interop/live/python');
const pythonClient = path.join(pythonRoot, 'client.py');
const pythonServer = path.join(pythonRoot, 'server.py');
const testApiKey = process.env['A2A_INTEROP_TEST_API_KEY'] ?? 'test';

function commandEnvironment(extra = {}) {
  const environment = {};
  for (const key of [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SYSTEMROOT',
    'COMSPEC',
    'PATHEXT',
    'CI',
  ]) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

async function runJsonCommand({ command, args, cwd, env = {}, secrets = [] }) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env: commandEnvironment(env),
      timeout: 45_000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    const line = stdout
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((entry) => entry.trim().startsWith('{'));
    if (!line) {
      throw new Error(`Command returned no JSON result. stderr=${stderr.slice(-2_048)}`);
    }
    return JSON.parse(line);
  } catch (error) {
    const details = {
      message: error instanceof Error ? error.message : String(error),
      stdout: error && typeof error === 'object' && 'stdout' in error ? error.stdout : '',
      stderr: error && typeof error === 'object' && 'stderr' in error ? error.stderr : '',
    };
    throw new Error(JSON.stringify(redactDiagnostic(details, secrets)));
  }
}

async function withParticipant(options, execute) {
  const participant = startParticipant(options);
  try {
    const ready = await participant.waitUntilReady();
    return await execute(ready);
  } catch (error) {
    const diagnostics = participant.diagnostics();
    throw new Error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        participant: diagnostics,
      }),
    );
  } finally {
    await participant.stop();
  }
}

async function buildRuntime() {
  await execFileAsync(
    process.execPath,
    [path.join(root, 'scripts/run-pnpm.mjs'), '--filter', '@a2amesh/runtime', 'run', 'build'],
    {
      cwd: root,
      env: commandEnvironment(),
      timeout: 180_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
}

function pythonInterpreter() {
  if (process.env['A2A_INTEROP_PYTHON']) return process.env['A2A_INTEROP_PYTHON'];
  return process.platform === 'win32'
    ? path.join(pythonRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(pythonRoot, '.venv', 'bin', 'python');
}

async function executeScenario(scenario) {
  if (scenario.id === 'official-javascript-client-to-mesh') {
    return withParticipant(
      {
        name: 'mesh-authenticated',
        command: process.execPath,
        args: [meshServer, 'authenticated'],
        cwd: root,
        env: {
          A2A_INTEROP_API_KEY: testApiKey,
          A2A_INTEROP_PORT: '0',
          NODE_NO_WARNINGS: '1',
        },
        secrets: [testApiKey],
        startupTimeoutMs: 15_000,
      },
      (ready) =>
        runJsonCommand({
          command: process.execPath,
          args: [javascriptClient, 'blocking-auth', String(ready['url'])],
          cwd: javascriptRoot,
          env: { A2A_INTEROP_API_KEY: testApiKey, NODE_NO_WARNINGS: '1' },
          secrets: [testApiKey],
        }),
    );
  }

  if (scenario.id === 'mesh-client-to-official-javascript') {
    return withParticipant(
      {
        name: 'official-javascript-server',
        command: process.execPath,
        args: [javascriptServer],
        cwd: root,
        env: { A2A_INTEROP_PORT: '0', NODE_NO_WARNINGS: '1' },
        startupTimeoutMs: 15_000,
      },
      (ready) =>
        runJsonCommand({
          command: process.execPath,
          args: [meshClient, 'streaming', String(ready['url'])],
          cwd: root,
          env: { A2A_INTEROP_RPC_DIALECT: 'official-v1', NODE_NO_WARNINGS: '1' },
        }),
    );
  }

  if (scenario.id === 'negative-protocol-version') {
    return withParticipant(
      {
        name: 'mesh-negative-version',
        command: process.execPath,
        args: [meshServer, 'complete'],
        cwd: root,
        env: { A2A_INTEROP_PORT: '0', NODE_NO_WARNINGS: '1' },
        startupTimeoutMs: 15_000,
      },
      (ready) =>
        runJsonCommand({
          command: process.execPath,
          args: [meshClient, 'negative-version', String(ready['url'])],
          cwd: root,
          env: { NODE_NO_WARNINGS: '1' },
        }),
    );
  }

  if (scenario.id === 'official-python-client-to-mesh') {
    const python = pythonInterpreter();
    return withParticipant(
      {
        name: 'mesh-cancellable',
        command: process.execPath,
        args: [meshServer, 'cancellable'],
        cwd: root,
        env: { A2A_INTEROP_PORT: '0', NODE_NO_WARNINGS: '1' },
        startupTimeoutMs: 15_000,
      },
      (ready) =>
        runJsonCommand({
          command: python,
          args: [pythonClient, 'cancel', String(ready['url'])],
          cwd: pythonRoot,
          env: { PYTHONUNBUFFERED: '1' },
        }),
    );
  }

  if (scenario.id === 'mesh-client-to-official-python') {
    const python = pythonInterpreter();
    return withParticipant(
      {
        name: 'official-python-server',
        command: python,
        args: [pythonServer],
        cwd: root,
        env: { A2A_INTEROP_PORT: '0', PYTHONUNBUFFERED: '1' },
        startupTimeoutMs: 20_000,
      },
      async (ready) => {
        const url = String(ready['url']);
        const blocking = await runJsonCommand({
          command: process.execPath,
          args: [meshClient, 'blocking', url],
          cwd: root,
          env: { A2A_INTEROP_RPC_DIALECT: 'official-v1', NODE_NO_WARNINGS: '1' },
        });
        const streaming = await runJsonCommand({
          command: process.execPath,
          args: [meshClient, 'streaming', url],
          cwd: root,
          env: { A2A_INTEROP_RPC_DIALECT: 'official-v1', NODE_NO_WARNINGS: '1' },
        });
        return { blocking, streaming };
      },
    );
  }

  throw new Error(`Unknown live interop scenario: ${scenario.id}`);
}

async function verifyFile(filePath) {
  await access(filePath);
  return filePath;
}

async function checkLiveInteropContract(manifest, scenarios) {
  await Promise.all([
    verifyFile(meshServer),
    verifyFile(meshClient),
    verifyFile(javascriptClient),
    verifyFile(javascriptServer),
    verifyFile(pythonClient),
    verifyFile(pythonServer),
  ]);

  const javascriptPackage = JSON.parse(
    await readFile(path.join(javascriptRoot, 'package.json'), 'utf8'),
  );
  const javascriptLock = JSON.parse(
    await readFile(path.join(javascriptRoot, 'package-lock.json'), 'utf8'),
  );
  const requirements = await readFile(path.join(pythonRoot, 'requirements.txt'), 'utf8');

  const errors = [];
  if (
    javascriptPackage.dependencies?.[manifest.javascript.package] !== manifest.javascript.version
  ) {
    errors.push('JavaScript package.json does not match the live manifest');
  }
  if (javascriptPackage.engines?.node !== manifest.nodeVersion) {
    errors.push('JavaScript Node engine does not match the live manifest');
  }
  if (
    javascriptLock.packages?.['']?.dependencies?.[manifest.javascript.package] !==
    manifest.javascript.version
  ) {
    errors.push('JavaScript package-lock.json does not match the live manifest');
  }
  if (
    !requirements
      .split(/\r?\n/)
      .includes(`${manifest.python.package}==${manifest.python.version}`) &&
    !requirements
      .split(/\r?\n/)
      .includes(`${manifest.python.package}[http-server]==${manifest.python.version}`)
  ) {
    errors.push('Python requirements do not match the live manifest');
  }
  if (scenarios.length === 0) errors.push('No live interop scenarios selected');
  if (errors.length > 0) {
    throw new Error(`Live interop contract check failed:\n- ${errors.join('\n- ')}`);
  }
}

async function main() {
  const options = parseLiveInteropArgs(process.argv.slice(2));
  const manifest = await loadLiveInteropManifest(root);
  const scenarios = selectLiveInteropScenarios(options.ecosystem);
  const reportPath = path.isAbsolute(options.report)
    ? options.report
    : path.join(root, options.report);

  if (options.check) {
    await checkLiveInteropContract(manifest, scenarios);
    const report = {
      schemaVersion: manifest.schemaVersion,
      mode: 'check',
      status: 'passed',
      ecosystem: options.ecosystem,
      protocolVersion: manifest.protocolVersion,
      runtimes: {
        node: manifest.nodeVersion,
        python: manifest.pythonVersion,
      },
      sdks: {
        javascript: manifest.javascript,
        python: manifest.python,
      },
      scenarios: scenarios.map((scenario) => ({ ...scenario, status: 'checked' })),
    };
    await writeLiveInteropReport(root, report, reportPath);
    console.log(`Live official SDK interop check passed (${scenarios.length} scenarios).`);
    return;
  }

  await checkLiveInteropContract(manifest, scenarios);
  await buildRuntime();
  if (options.ecosystem === 'python' || options.ecosystem === 'all') {
    await verifyFile(pythonInterpreter());
  }
  if (options.ecosystem === 'javascript' || options.ecosystem === 'all') {
    await verifyFile(path.join(javascriptRoot, 'node_modules', '@a2a-js', 'sdk', 'package.json'));
  }

  const matrix = await runScenarioMatrix({
    scenarios,
    executeScenario,
    secrets: [testApiKey],
  });
  const report = {
    ...matrix,
    ecosystem: options.ecosystem,
    protocolVersion: manifest.protocolVersion,
    runtimes: {
      node: manifest.nodeVersion,
      python: manifest.pythonVersion,
    },
    sdks: {
      javascript: manifest.javascript,
      python: manifest.python,
    },
  };
  await writeLiveInteropReport(root, report, reportPath);

  if (matrix.status === 'failed') {
    const diagnosticsPath = path.join(path.dirname(reportPath), 'diagnostics.json');
    await writeLiveInteropReport(
      root,
      {
        schemaVersion: manifest.schemaVersion,
        status: 'failed',
        failures: matrix.scenarios.filter((scenario) => scenario.status === 'failed'),
      },
      diagnosticsPath,
    );
    throw new Error(`Live official SDK interop failed; see ${diagnosticsPath}`);
  }

  console.log(`Live official SDK interop passed (${scenarios.length} scenarios).`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
