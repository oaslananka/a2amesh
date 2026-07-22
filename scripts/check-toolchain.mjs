#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveCorepackInvocation,
  resolveExecutable,
  spawnCommand,
} from './toolchain-command.mjs';

export { resolveExecutable } from './toolchain-command.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const REMEDIATION = [
  'mise users: run `mise trust && mise install && mise reshim` from the repository root.',
  'Corepack users: run `corepack enable` and retry the doctor.',
  'Bootstrap or immutable automation: use `node scripts/run-pnpm.mjs install --frozen-lockfile`.',
];

export function validateToolchainDiagnostics(manifest, diagnostics) {
  const failures = [];
  if (!manifest.nodeCompatibility.includes(diagnostics.node.version)) {
    failures.push(
      `Node.js ${diagnostics.node.version} is not in the supported compatibility set: ${manifest.nodeCompatibility.join(', ')}`,
    );
  }

  const expectedPackageManager = `pnpm@${manifest.pnpm}`;
  if (diagnostics.packageManager !== expectedPackageManager) {
    failures.push(
      `packageManager must be ${expectedPackageManager}, received ${diagnostics.packageManager || '<missing>'}`,
    );
  }

  validatePnpmCommand('direct pnpm', diagnostics.directPnpm, manifest.pnpm, failures);
  validatePnpmCommand('Corepack pnpm', diagnostics.corepackPnpm, manifest.pnpm, failures);
  validatePnpmCommand('child-process pnpm', diagnostics.childPnpm, manifest.pnpm, failures);

  if (
    diagnostics.directPnpm.executable &&
    diagnostics.childPnpm.executable &&
    normalizeExecutable(diagnostics.directPnpm.executable) !==
      normalizeExecutable(diagnostics.childPnpm.executable)
  ) {
    failures.push(
      `child-process pnpm executable ${diagnostics.childPnpm.executable} does not match direct pnpm executable ${diagnostics.directPnpm.executable}`,
    );
  }

  return failures;
}

function validatePnpmCommand(label, command, expectedVersion, failures) {
  if (command.error || !command.version) {
    failures.push(`${label} failed: ${command.error || 'no version output'}`);
    return;
  }
  if (command.version !== expectedVersion) {
    failures.push(`${label} resolved ${command.version} instead of ${expectedVersion}`);
  }
}

function normalizeExecutable(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function runVersion(executable, args, env = process.env, reportedExecutable = executable) {
  if (!executable)
    return { version: null, executable: null, error: 'executable not found on PATH' };
  const result = spawnCommand(executable, args, { encoding: 'utf8', env });
  const version = result.status === 0 ? result.stdout.trim() : null;
  const error =
    result.status === 0
      ? undefined
      : result.error?.message || result.stderr.trim() || `exit code ${result.status ?? 'unknown'}`;
  return { version, executable: reportedExecutable, ...(error ? { error } : {}) };
}

function collectDirectPnpm(env = process.env) {
  const executable = resolveExecutable('pnpm', env);
  return runVersion(executable, ['--version'], env);
}

function collectChildPnpm(env = process.env) {
  const child = spawnCommand(process.execPath, [scriptPath, '--child'], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  if (child.status !== 0) {
    return {
      version: null,
      executable: null,
      error:
        child.error?.message || child.stderr.trim() || `exit code ${child.status ?? 'unknown'}`,
    };
  }
  try {
    return JSON.parse(child.stdout);
  } catch (error) {
    return {
      version: null,
      executable: null,
      error: `invalid child diagnostics: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function collectToolchainDiagnostics({ env = process.env, cwd = process.cwd() } = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const corepackInvocation = resolveCorepackInvocation(process.execPath);
  return {
    node: { version: process.version.replace(/^v/, ''), executable: process.execPath },
    packageManager: packageJson.packageManager,
    directPnpm: collectDirectPnpm(env),
    corepackPnpm: corepackInvocation
      ? runVersion(
          corepackInvocation.executable,
          [...corepackInvocation.argsPrefix, 'pnpm', '--version'],
          env,
          corepackInvocation.corepackPath,
        )
      : {
          version: null,
          executable: null,
          error: 'Corepack executable was not found beside Node.js',
        },
    childPnpm: collectChildPnpm(env),
  };
}

function printCommand(label, command) {
  const version = command.version || '<failed>';
  const executable = command.executable || '<not found>';
  console.log(`${label}: ${version} (${executable})`);
  if (command.error) console.log(`  error: ${command.error}`);
}

function runChildMode() {
  process.stdout.write(JSON.stringify(collectDirectPnpm()));
}

function runCli() {
  const manifest = JSON.parse(readFileSync('tools/runtime-versions.json', 'utf8'));
  const diagnostics = collectToolchainDiagnostics();
  const failures = validateToolchainDiagnostics(manifest, diagnostics);

  console.log('A2A Mesh toolchain diagnostics');
  console.log(`Node.js: ${diagnostics.node.version} (${diagnostics.node.executable})`);
  console.log(`packageManager: ${diagnostics.packageManager || '<missing>'}`);
  printCommand('pnpm from PATH', diagnostics.directPnpm);
  printCommand('pnpm through Corepack', diagnostics.corepackPnpm);
  printCommand('pnpm from Node child', diagnostics.childPnpm);

  if (failures.length === 0) {
    console.log('Toolchain check passed.');
    return;
  }

  console.error('Toolchain check failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nRemediation:');
  for (const instruction of REMEDIATION) console.error(`- ${instruction}`);
  process.exitCode = 1;
}

if (process.argv.includes('--child')) runChildMode();
else if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runCli();
