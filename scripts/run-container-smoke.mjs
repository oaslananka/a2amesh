#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, containerName) {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`health endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    const running = docker(['inspect', '--format', '{{.State.Running}}', containerName]);
    if (running !== 'true') break;
    await sleep(1_000);
  }

  throw new Error(
    `Container did not become healthy at ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function parsePublishedPort(value) {
  const line = value.split(/\r?\n/).find(Boolean);
  if (!line) throw new Error('Docker did not publish a health port.');
  const match = line.match(/:(\d+)$/);
  if (!match) throw new Error(`Unable to parse published port: ${line}`);
  return Number(match[1]);
}

async function main() {
  const [component, image] = process.argv.slice(2);
  if (!component || !image || !['runtime', 'registry'].includes(component)) {
    process.stderr.write(
      'Usage: node scripts/run-container-smoke.mjs <runtime|registry> <image>\n',
    );
    process.exit(2);
  }

  const containerPort = component === 'runtime' ? 3003 : 3099;
  const containerName = `a2amesh-${component}-smoke-${process.pid}`;
  const args = [
    'run',
    '--detach',
    '--name',
    containerName,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--publish',
    `127.0.0.1::${containerPort}`,
  ];

  if (component === 'runtime') {
    args.push('--env', 'OPENAI_API_KEY=container-smoke-placeholder');
    args.push('--env', 'RUN_EMBEDDED_REGISTRY=true');
  }

  args.push(image);

  try {
    docker(args);
    const published = docker(['port', containerName, `${containerPort}/tcp`]);
    const port = parsePublishedPort(published);
    await waitForHealth(`http://127.0.0.1:${port}/health`, containerName);

    const user = docker(['inspect', '--format', '{{.Config.User}}', containerName]);
    if (user !== '10001:10001') {
      throw new Error(`Expected container user 10001:10001, received ${user || '<empty>'}.`);
    }

    const readOnly = docker([
      'inspect',
      '--format',
      '{{.HostConfig.ReadonlyRootfs}}',
      containerName,
    ]);
    if (readOnly !== 'true') throw new Error('Smoke container root filesystem is not read-only.');

    process.stdout.write(`${component} container smoke test passed on ${port}.\n`);
  } catch (error) {
    const logs = spawnSync('docker', ['logs', containerName], { encoding: 'utf8' });
    if (logs.stdout) process.stderr.write(logs.stdout);
    if (logs.stderr) process.stderr.write(logs.stderr);
    throw error;
  } finally {
    spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
  }
}

await main();
