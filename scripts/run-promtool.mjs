#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '3.13.1';
const ARCHIVE = `prometheus-${VERSION}.linux-amd64.tar.gz`;
const DOWNLOAD_URL = `https://github.com/prometheus/prometheus/releases/download/v${VERSION}/${ARCHIVE}`;
const EXPECTED_SHA256 = '962b812371aff838d152b6ff2d56fdb7a6396f5542f48ebf73421b9721f0d103';

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function downloadVerifiedPromtool() {
  const cache = join(tmpdir(), 'a2amesh-promtool', `v${VERSION}`);
  const binary = join(cache, process.platform === 'win32' ? 'promtool.exe' : 'promtool');
  if (await exists(binary)) return binary;

  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archivePath = join(cache, ARCHIVE);
  const partialPath = `${archivePath}.${process.pid}.partial`;
  const response = await fetch(DOWNLOAD_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`promtool download failed with HTTP ${response.status}.`);
  const content = Buffer.from(await response.arrayBuffer());
  await writeFile(partialPath, content, { flag: 'wx', mode: 0o600 });
  const observed = await sha256(partialPath);
  if (observed !== EXPECTED_SHA256) {
    await rm(partialPath, { force: true });
    throw new Error(
      `promtool archive SHA-256 mismatch: expected ${EXPECTED_SHA256}, observed ${observed}.`,
    );
  }
  await rename(partialPath, archivePath);

  const extracted = spawnSync(
    'tar',
    [
      '-xzf',
      archivePath,
      '--strip-components=1',
      '-C',
      cache,
      `prometheus-${VERSION}.linux-amd64/promtool`,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0) {
    throw new Error(`Unable to extract promtool: ${extracted.stderr}`);
  }
  if (process.platform !== 'win32') await chmod(binary, 0o700);
  return binary;
}

export async function runPromtool(root = process.cwd()) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(
      'Pinned recovery alert verification currently supports Linux x64 CI hosts only.',
    );
  }
  const binary = await downloadVerifiedPromtool();
  const rulesDirectory = resolve(root, 'ops/prometheus');
  const result = spawnSync(binary, ['test', 'rules', 'a2amesh-alerts.test.yml'], {
    cwd: rulesDirectory,
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`promtool rule tests failed with exit code ${String(result.status)}.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPromtool().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
