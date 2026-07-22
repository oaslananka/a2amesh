#!/usr/bin/env node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolveCorepackInvocation,
  spawnCommand,
  withPrependedPath,
} from './toolchain-command.mjs';

export function renderPnpmShim(platform = process.platform) {
  if (platform === 'win32') {
    return [
      '@echo off',
      'call "%A2AMESH_COREPACK_EXECUTABLE%" pnpm %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n');
  }
  return '#!/bin/sh\nexec "$A2AMESH_NODE_EXECUTABLE" "$A2AMESH_COREPACK_SCRIPT" pnpm "$@"\n';
}

export function runPnpmWithShimSync(args, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const invocation = resolveCorepackInvocation(process.execPath, platform);
  if (!invocation) throw commandError('Corepack executable was not found beside Node.js.', 127);

  const shimDirectory = mkdtempSync(path.join(tmpdir(), 'a2amesh-corepack-pnpm-'));
  const shimPath = path.join(shimDirectory, platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  try {
    writeFileSync(shimPath, renderPnpmShim(platform));
    if (platform !== 'win32') chmodSync(shimPath, 0o755);

    const childEnv = withPrependedPath(env, shimDirectory, platform);
    childEnv.A2AMESH_COREPACK_EXECUTABLE = invocation.corepackPath;
    childEnv.A2AMESH_NODE_EXECUTABLE = invocation.executable;
    childEnv.A2AMESH_COREPACK_SCRIPT = invocation.corepackPath;
    const { platform: _platform, ...spawnOptions } = options;
    const result = spawnCommand(
      invocation.executable,
      [...invocation.argsPrefix, 'pnpm', ...args],
      {
        ...spawnOptions,
        env: childEnv,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw commandError(
        `Corepack pnpm exited with status ${result.status ?? 'unknown'}.`,
        result.status ?? 1,
        result.stdout,
        result.stderr,
      );
    }
    return result.stdout;
  } finally {
    rmSync(shimDirectory, { recursive: true, force: true });
  }
}

function commandError(message, status, stdout, stderr) {
  const error = new Error(message);
  error.status = status;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

function runCli() {
  if (process.argv.length < 3) {
    console.error('Usage: node scripts/run-pnpm.mjs <pnpm arguments...>');
    process.exitCode = 2;
    return;
  }
  try {
    runPnpmWithShimSync(process.argv.slice(2), { stdio: 'inherit' });
  } catch (error) {
    if (error instanceof Error && !error.stderr) console.error(error.message);
    process.exitCode = Number(error?.status) || 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runCli();
