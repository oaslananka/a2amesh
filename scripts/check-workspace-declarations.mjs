/**
 * Validate that pnpm-workspace.yaml is the single source of truth
 * for workspace package declarations and the canonical lockfile topology.
 *
 * This script runs as part of verify:structure.
 * Uses git ls-files to discover workspace contents (matching repo convention).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { listFiles, readJson, fail } from './check-utils.mjs';

const EXPECTED_INJECTED_WORKSPACE_RESOLUTIONS = new Map([
  ['apps/demo|@a2amesh/internal-adapter-anthropic', 'file:packages/adapter-anthropic'],
  ['packages/adapters|@a2amesh/internal-adapter-anthropic', 'file:packages/adapter-anthropic'],
]);
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ── 1. pnpm-workspace.yaml must exist and be parseable ────────────────────
if (!existsSync('pnpm-workspace.yaml')) {
  fail('pnpm-workspace.yaml not found — it must be the canonical workspace source.');
  process.exit(1);
}

const raw = readFileSync('pnpm-workspace.yaml', 'utf8');
const failures = [];

// Extract the packages list from YAML (simple line-based parse)
const lines = raw.split('\n');
const packagePatterns = [];
let inPackages = false;
for (const line of lines) {
  if (line.trim() === 'packages:') {
    inPackages = true;
    continue;
  }
  if (inPackages) {
    if (/^\s+-/.test(line)) {
      const pattern = line.replace(/^\s*-\s*/, '').trim();
      packagePatterns.push(pattern);
    } else if (/^[a-z]/.test(line.trim()) && line.trim().endsWith(':')) {
      inPackages = false;
    }
  }
}

if (packagePatterns.length === 0) {
  failures.push('pnpm-workspace.yaml packages list is empty.');
}

if (!/^injectWorkspacePackages:\s+true\s*$/m.test(raw)) {
  failures.push('pnpm-workspace.yaml must keep injectWorkspacePackages: true');
}
if (!/^syncInjectedDepsAfterScripts:\s*\n\s+-\s+build\s*$/m.test(raw)) {
  failures.push('pnpm-workspace.yaml must synchronize injected workspace dependencies after build');
}

// ── 2. Root package.json must NOT have a workspaces field ─────────────────
const rootPkg = readJson('package.json');
if (rootPkg.workspaces) {
  failures.push(
    'Root package.json must not contain a "workspaces" field; ' +
      'pnpm-workspace.yaml is the single source of truth.',
  );
}

// ── 3. Build a set of expected workspace directories from git-tracked files
const allFiles = listFiles();
const workspaceDirs = new Set();

// Map pnpm patterns to their expanded directories
const patternExpansions = {
  'packages/*': () => {
    const dirs = new Set();
    for (const f of allFiles) {
      const m = f.match(/^packages\/([^/]+)\/package\.json$/);
      if (m) dirs.add(`packages/${m[1]}`);
    }
    return [...dirs].sort();
  },
  'apps/*': () => {
    const dirs = new Set();
    for (const f of allFiles) {
      const m = f.match(/^apps\/([^/]+)\/package\.json$/);
      if (m) dirs.add(`apps/${m[1]}`);
    }
    return [...dirs].sort();
  },
  'examples/*': () => {
    const dirs = new Set();
    for (const f of allFiles) {
      const m = f.match(/^examples\/([^/]+)\/package\.json$/);
      if (m) dirs.add(`examples/${m[1]}`);
    }
    return [...dirs].sort();
  },
};

const defaultMatch = (pattern) => {
  if (!pattern.includes('*') && !pattern.includes('?')) {
    if (existsSync(`${pattern}/package.json`)) return [pattern];
    return [];
  }
  return [];
};

// ── 4. Verify each pattern and collect workspace directories ──────────────
const allWorkspaceDirs = [];

for (const pattern of packagePatterns) {
  let dirs;
  if (patternExpansions[pattern]) {
    dirs = patternExpansions[pattern]();
  } else {
    dirs = defaultMatch(pattern);
  }

  if (dirs.length === 0) {
    failures.push(`pnpm-workspace.yaml pattern "${pattern}" matched zero workspace directories`);
  }
  for (const d of dirs) {
    allWorkspaceDirs.push(d);
    workspaceDirs.add(d);
  }
}

// ── 5. Every matched directory must have a package.json ───────────────────
for (const dir of allWorkspaceDirs) {
  if (!existsSync(`${dir}/package.json`)) {
    failures.push(`Workspace directory "${dir}" is missing a package.json`);
  }
}

// ── 6. Check for package.json files in workspace that are NOT covered ─────
const uncovered = [];
for (const f of allFiles) {
  if (f.endsWith('/package.json') && f !== 'package.json') {
    const dir = dirname(f);
    const isInWorkspaceRoot = packagePatterns.some((pattern) => {
      const basePattern = pattern.replace('/*', '');
      return dir.startsWith(basePattern) || dir === pattern;
    });
    if (isInWorkspaceRoot && !workspaceDirs.has(dir)) {
      uncovered.push(dir);
    }
  }
}

if (uncovered.length > 0) {
  failures.push(
    `Directories with package.json not covered by pnpm-workspace.yaml: ${uncovered.join(', ')}`,
  );
}

// ── 7. Exact direct dependency pins must agree with canonical overrides ───
const workspaceOverrides = parseSimpleYamlMap(raw, 'overrides');
const manifests = [
  ['package.json', rootPkg],
  ...allWorkspaceDirs.map((dir) => [`${dir}/package.json`, readJson(`${dir}/package.json`)]),
];
for (const [manifestPath, manifest] of manifests) {
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      const override = workspaceOverrides.get(name);
      if (!override || typeof specifier !== 'string' || !EXACT_VERSION.test(specifier)) continue;
      if (specifier !== override) {
        failures.push(
          `${manifestPath}: ${name} ${specifier} must match pnpm-workspace.yaml override ${override}`,
        );
      }
    }
  }
}

// ── 8. Lockfile workspace resolutions must preserve the reviewed topology ─
if (!existsSync('pnpm-lock.yaml')) {
  failures.push('pnpm-lock.yaml not found — workspace topology cannot be verified');
} else {
  const lockfileRaw = readFileSync('pnpm-lock.yaml', 'utf8');
  const lockfileOverrides = parseSimpleYamlMap(lockfileRaw, 'overrides');

  for (const [name, version] of workspaceOverrides) {
    const lockedVersion = lockfileOverrides.get(name);
    if (lockedVersion !== version) {
      failures.push(
        `pnpm-lock.yaml override ${name}=${lockedVersion ?? '<missing>'} must match pnpm-workspace.yaml ${version}`,
      );
    }
  }

  for (const resolution of parseWorkspaceImporterResolutions(lockfileRaw)) {
    const key = `${resolution.importer}|${resolution.name}`;
    const expectedInjectedPrefix = EXPECTED_INJECTED_WORKSPACE_RESOLUTIONS.get(key);
    if (expectedInjectedPrefix) {
      if (!resolution.version.startsWith(expectedInjectedPrefix)) {
        failures.push(
          `${resolution.importer}: ${resolution.name} must keep reviewed injected workspace resolution ${expectedInjectedPrefix}`,
        );
      }
      continue;
    }
    if (!resolution.version.startsWith('link:')) {
      failures.push(
        `${resolution.importer}: ${resolution.name} has unexpected injected workspace resolution ${resolution.version}`,
      );
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  fail('Workspace declaration validation failed.', failures);
} else {
  console.log(
    `Workspace declaration validation passed: ${packagePatterns.length} patterns, ${workspaceDirs.size} workspace directories.`,
  );
}

function parseSimpleYamlMap(text, sectionName) {
  const result = new Map();
  const sectionLines = text.split(/\r?\n/);
  const start = sectionLines.findIndex((line) => line === `${sectionName}:`);
  if (start === -1) return result;

  for (let index = start + 1; index < sectionLines.length; index += 1) {
    const line = sectionLines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break;
    const match = /^  (.+?):\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    result.set(stripYamlQuotes(match[1]), stripYamlQuotes(match[2]));
  }
  return result;
}

function parseWorkspaceImporterResolutions(text) {
  const resolutions = [];
  const lockLines = text.split(/\r?\n/);
  const importersStart = lockLines.findIndex((line) => line === 'importers:');
  if (importersStart === -1) return resolutions;

  let importer;
  let dependencyName;
  let workspaceSpecifier = false;
  for (let index = importersStart + 1; index < lockLines.length; index += 1) {
    const line = lockLines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:\s*$/.test(line)) break;

    const importerMatch = /^  ([^ ].*):\s*$/.exec(line);
    if (importerMatch) {
      importer = stripYamlQuotes(importerMatch[1]);
      dependencyName = undefined;
      workspaceSpecifier = false;
      continue;
    }

    const dependencyMatch = /^      (.+):\s*$/.exec(line);
    if (dependencyMatch) {
      dependencyName = stripYamlQuotes(dependencyMatch[1]);
      workspaceSpecifier = false;
      continue;
    }

    const specifierMatch = /^        specifier:\s+(.+?)\s*$/.exec(line);
    if (specifierMatch) {
      workspaceSpecifier = stripYamlQuotes(specifierMatch[1]).startsWith('workspace:');
      continue;
    }

    const versionMatch = /^        version:\s+(.+?)\s*$/.exec(line);
    if (versionMatch && importer && dependencyName && workspaceSpecifier) {
      resolutions.push({
        importer,
        name: dependencyName,
        version: stripYamlQuotes(versionMatch[1]),
      });
    }
  }
  return resolutions;
}

function stripYamlQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
