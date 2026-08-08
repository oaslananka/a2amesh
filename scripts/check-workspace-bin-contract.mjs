import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { fail, getWorkspacePackages } from './check-utils.mjs';

const failures = [];

function normalizeTarget(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function binEntries(packageJson) {
  if (!packageJson.bin) return [];
  if (typeof packageJson.bin === 'string') return [[packageJson.name, packageJson.bin]];
  if (typeof packageJson.bin === 'object' && !Array.isArray(packageJson.bin)) {
    return Object.entries(packageJson.bin);
  }
  return [];
}

function isSourceVisible(path) {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return output.trim().length > 0;
  } catch {
    // Temp fixture directories used by integration tests are intentionally not Git repositories.
    return true;
  }
}

for (const entry of getWorkspacePackages()) {
  const packageName = entry.packageJson.name ?? entry.dir;
  for (const [binName, rawTarget] of binEntries(entry.packageJson)) {
    if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
      failures.push(`${packageName}: ${binName} declared bin target must be a non-empty path`);
      continue;
    }
    const target = normalizeTarget(rawTarget.trim());
    if (
      isAbsolute(target) ||
      target === '..' ||
      target.startsWith('../') ||
      target.includes('/../')
    ) {
      failures.push(`${packageName}: declared bin target ${target} must stay inside its package`);
      continue;
    }
    if (target === 'dist' || target.startsWith('dist/')) {
      failures.push(
        `${packageName}: ${binName} must target a committed prebuild launcher, not generated dist output`,
      );
      continue;
    }

    const packageTarget = normalize(join(entry.dir, normalize(target)));
    if (!existsSync(packageTarget) || !statSync(packageTarget).isFile()) {
      failures.push(`${packageName}: declared bin target ${target} is missing before build`);
      continue;
    }
    if (!isSourceVisible(packageTarget)) {
      failures.push(`${packageName}: declared bin target ${target} must be source-controlled`);
    }

    const content = readFileSync(packageTarget, 'utf8');
    if (!content.startsWith('#!/usr/bin/env node')) {
      failures.push(
        `${packageName}: declared bin target ${target} must use the Node.js launcher shebang`,
      );
    }
    if (process.platform !== 'win32' && (statSync(packageTarget).mode & 0o111) === 0) {
      failures.push(
        `${packageName}: declared bin target ${target} must be executable before build`,
      );
    }
  }
}

if (failures.length > 0) fail('Workspace binary contract validation failed.', failures);
else console.log('Workspace binary contract validation passed.');
