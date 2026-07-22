import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';
import { runPnpmWithShimSync } from './run-pnpm.mjs';

const repoRoot = process.cwd();
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.mts',
  '.scss',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const textNames = new Set([
  '.codespellrc',
  '.dockerignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.prettierignore',
  'CODEOWNERS',
  'LICENSE',
  'Taskfile.yml',
]);
const skippedDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test-results',
  '.turbo',
  '.cache',
  '.nyc_output',
  '.playwright',
  '.artifacts',
  '.codex-checkpoints',
]);

function normalizePath(path) {
  return path.split('\\').join('/');
}

function isSkippedPath(path) {
  const normalized = normalizePath(path);
  return normalized.split('/').some((part) => skippedDirs.has(part));
}

export function isTextFile(path) {
  const name = path.split(/[\\/]/).pop() ?? '';
  return textNames.has(name) || textExtensions.has(extname(name));
}

function listGitFiles() {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return output
      .split('\0')
      .filter(Boolean)
      .map(normalizePath)
      .filter((file) => existsSync(join(repoRoot, file)))
      .filter((file) => !isSkippedPath(file))
      .sort();
  } catch {
    return undefined;
  }
}

export function listFiles(dir = repoRoot, files = []) {
  if (dir === repoRoot && files.length === 0) {
    const gitFiles = listGitFiles();
    if (gitFiles) return gitFiles;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = normalizePath(relative(repoRoot, full));
    if (entry.isDirectory()) {
      if (!isSkippedPath(rel)) listFiles(full, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

export function readText(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

export function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

export function runCommandSync(file, args, options = {}) {
  if (process.platform === 'win32' && file.toLowerCase().endsWith('.cmd')) {
    const resolvedFile = resolveWindowsCommand(file, options.env);
    const command = [
      `call "${resolvedFile.replaceAll('"', '""')}"`,
      ...args.map(quoteCmdArgument),
    ].join(' ');
    return execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return execFileSync(file, args, options);
}

function resolveWindowsCommand(file, env) {
  if (isAbsolute(file)) return file;
  try {
    return execFileSync('where.exe', [file], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .find(Boolean);
  } catch {
    return file;
  }
}

function quoteCmdArgument(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

export function runPnpmSync(args, options = {}) {
  const pnpmExecPath = options.env?.npm_execpath ?? process.env.npm_execpath;
  if (pnpmExecPath) {
    return execFileSync(process.execPath, [pnpmExecPath, ...args], options);
  }
  return runPnpmWithShimSync(args, options);
}

export function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exitCode = 1;
}

function collectPackageJsonFiles() {
  return listFiles().filter((file) => file.endsWith('package.json') && !isSkippedPath(file));
}

export function getWorkspacePackages() {
  return collectPackageJsonFiles()
    .map((path) => ({
      path,
      dir: path.replace(/\/package\.json$/, ''),
      packageJson: readJson(path),
    }))
    .filter(
      (entry) =>
        entry.path === 'package.json' ||
        entry.dir.startsWith('packages/') ||
        entry.dir.startsWith('apps/') ||
        entry.dir.startsWith('examples/') ||
        entry.dir === 'docs-site',
    );
}
