import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { get } from 'node:https';

const GITLEAKS_VERSION = process.env.GITLEAKS_VERSION ?? '8.30.1';
const LINUX_X64_SHA256 = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';
const DEFAULT_ARGS = [
  'detect',
  '--source',
  '.',
  '--config',
  '.gitleaks.toml',
  '--redact',
  '--no-git',
];

function run(file, args) {
  return spawnSync(file, args, { stdio: 'inherit', shell: false });
}

function commandExists(command) {
  const probe =
    process.platform === 'win32'
      ? run('where.exe', [command])
      : run('sh', ['-lc', `command -v ${command}`]);
  return probe.status === 0;
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'user-agent': 'a2amesh-security-script' } }, (response) => {
      if (
        [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
        response.headers.location
      ) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${url} returned ${response.statusCode}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    }).on('error', reject);
  });
}

async function ensureBundledGitleaks() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(
      'gitleaks is not installed. Install gitleaks or run this script on linux x64 for automatic bootstrap.',
    );
  }

  const cacheDir = join(tmpdir(), `a2amesh-gitleaks-${GITLEAKS_VERSION}`);
  const binary = join(cacheDir, 'gitleaks');
  if (existsSync(binary)) return binary;

  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`);
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${basename(archive)}`;
  await download(url, archive);

  const hash = createHash('sha256')
    .update(await import('node:fs').then(({ readFileSync }) => readFileSync(archive)))
    .digest('hex');
  if (hash !== LINUX_X64_SHA256) {
    rmSync(cacheDir, { recursive: true, force: true });
    throw new Error(
      `gitleaks archive checksum mismatch: expected ${LINUX_X64_SHA256}, got ${hash}`,
    );
  }

  const extract = run('tar', ['-xzf', archive, '-C', cacheDir, 'gitleaks']);
  if (extract.status !== 0) throw new Error('failed to extract gitleaks archive');
  return binary;
}

async function main() {
  if (commandExists('gitleaks')) {
    process.exit(run('gitleaks', DEFAULT_ARGS).status ?? 1);
  }

  const binary = await ensureBundledGitleaks();
  process.exit(run(binary, DEFAULT_ARGS).status ?? 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
