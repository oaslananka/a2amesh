import { existsSync, writeFileSync } from 'node:fs';
import { getWorkspacePackages, readJson, readText, fail } from './check-utils.mjs';

const write = process.argv.includes('--write');
const manifestPath = 'tools/runtime-versions.json';
const semverPattern = /^\d+\.\d+\.\d+$/;
const compatibilityContextPrefix = 'CI / compatibility-smoke (';
const compatibilityMatrixKeys = new Set(['os', 'runner', 'node']);
const failures = [];

function readRuntimeManifest() {
  try {
    return readJson(manifestPath);
  } catch (error) {
    fail('Runtime version manifest is missing or invalid.', [
      `${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
    process.exit(1);
  }
}

function validateRuntimeManifest(manifest) {
  const expectedKeys = [
    'node',
    'nodeCompatibility',
    'nodeDockerAlpineDigest',
    'pnpm',
    'npmForPublish',
  ];
  for (const key of expectedKeys) {
    if (!(key in manifest)) failures.push(`${manifestPath}: missing ${key}`);
  }

  if (typeof manifest.node !== 'string' || !semverPattern.test(manifest.node)) {
    failures.push(`${manifestPath}: node must be an exact semver string without a v prefix`);
  }
  if (!Array.isArray(manifest.nodeCompatibility) || manifest.nodeCompatibility.length === 0) {
    failures.push(`${manifestPath}: nodeCompatibility must be a non-empty array`);
  } else {
    for (const version of manifest.nodeCompatibility) {
      if (typeof version !== 'string' || !semverPattern.test(version)) {
        failures.push(
          `${manifestPath}: nodeCompatibility entries must be exact semver strings without v prefixes`,
        );
      }
    }
    if (!manifest.nodeCompatibility.includes(manifest.node)) {
      failures.push(`${manifestPath}: nodeCompatibility must include node`);
    }
  }
  if (typeof manifest.pnpm !== 'string' || !semverPattern.test(manifest.pnpm)) {
    failures.push(`${manifestPath}: pnpm must be an exact semver string`);
  }
  if (
    typeof manifest.nodeDockerAlpineDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.nodeDockerAlpineDigest)
  ) {
    failures.push(`${manifestPath}: nodeDockerAlpineDigest must be a sha256 digest`);
  }
  if (typeof manifest.npmForPublish !== 'string' || !semverPattern.test(manifest.npmForPublish)) {
    failures.push(`${manifestPath}: npmForPublish must be an exact semver string`);
  }
}

function normalizeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeOrExpect(path, actual, expected) {
  if (actual === expected) return;
  if (write) {
    writeFileSync(path, expected);
    return;
  }
  failures.push(`${path}: does not match ${manifestPath}`);
}

function syncTextFile(path, expected) {
  writeOrExpect(path, readText(path), expected);
}

function syncWorkflowEnv(path, manifest) {
  const original = readText(path);
  let updated = original.replace(/NODE_VERSION:\s*'[^']+'/g, `NODE_VERSION: '${manifest.node}'`);
  if (path === '.github/workflows/ci.yml') {
    const compatibilityMinimum = manifest.nodeCompatibility.find(
      (version) => version !== manifest.node,
    );
    if (compatibilityMinimum) {
      updated = updated.replace(/node:\s*'22\.\d+\.\d+'/g, `node: '${compatibilityMinimum}'`);
    }
    updated = updated.replace(/node:\s*'24\.\d+\.\d+'/g, `node: '${manifest.node}'`);
  }
  if (path === '.github/workflows/publish.yml') {
    updated = updated.replace(
      /NPM_VERSION:\s*'[^']+'/g,
      `NPM_VERSION: '${manifest.npmForPublish}'`,
    );
  }
  writeOrExpect(path, original, updated);
}

function replaceGeneratedDigest(content, digest) {
  const lines = content.split('\n');
  const propertyIndex = lines.findIndex((line) => line.trim() === 'nodeDockerAlpineDigest:');
  if (propertyIndex < 0 || propertyIndex + 1 >= lines.length) return content;
  const valueLine = lines[propertyIndex + 1];
  const indentation = /^\s*/.exec(valueLine)?.[0] ?? '';
  lines[propertyIndex + 1] = `${indentation}'${digest}',`;
  return lines.join('\n');
}

function syncGeneratedScaffoldRuntime(manifest) {
  const path = 'packages/cli/src/generated/scaffold-template.ts';
  if (!existsSync(path)) return;
  const original = readText(path);
  const updated = replaceGeneratedDigest(original, manifest.nodeDockerAlpineDigest)
    .replace(/(\bnode:\s*')[^']+(')/, `$1${manifest.node}$2`)
    .replace(/(\bpnpm:\s*')[^']+(')/, `$1${manifest.pnpm}$2`);
  writeOrExpect(path, original, updated);
  for (const snippet of [
    `node: '${manifest.node}'`,
    manifest.nodeDockerAlpineDigest,
    `pnpm: '${manifest.pnpm}'`,
  ]) {
    if (!updated.includes(snippet)) {
      failures.push(`${path}: runtime values must match ${manifestPath}`);
      break;
    }
  }
}

function pnpmEngineRange(version) {
  const major = Number(version.split('.')[0]);
  return `>=${major} <${major + 1}`;
}

function syncWorkspacePnpm(manifest) {
  const engineRange = pnpmEngineRange(manifest.pnpm);
  for (const { path, packageJson } of getWorkspacePackages()) {
    const updated = structuredClone(packageJson);
    if (path === 'package.json' || updated.packageManager?.startsWith('pnpm@')) {
      updated.packageManager = `pnpm@${manifest.pnpm}`;
    }
    if (typeof updated.engines?.pnpm === 'string') {
      updated.engines.pnpm = engineRange;
    }
    if (path === 'package.json') {
      updated.scripts ??= {};
      updated.scripts.setup = 'node scripts/run-pnpm.mjs install --frozen-lockfile';
      updated.scripts['toolchain:check'] = 'node scripts/check-toolchain.mjs';
    }
    writeOrExpect(path, normalizeJson(packageJson), normalizeJson(updated));
  }
}

function syncPnpmDockerMirrors(manifest) {
  for (const path of ['apps/demo/Dockerfile', 'packages/registry/Dockerfile']) {
    if (!existsSync(path)) continue;
    const original = readText(path);
    const updated = original.replace(/^ARG PNPM_VERSION=.*$/m, `ARG PNPM_VERSION=${manifest.pnpm}`);
    writeOrExpect(path, original, updated);
  }
}

function replacePnpmMentions(content, version) {
  return content.replace(
    /(pnpm(?:@|-|\s+)(?:`)?)\d+\.\d+\.\d+(`?)/gi,
    (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
  );
}

function syncPnpmDocumentation(manifest) {
  const paths = [
    'README.md',
    'CONTRIBUTING.md',
    'docs/compatibility.md',
    'docs-site/guide/compatibility.md',
    'docs/openssf-evidence.md',
    'docs/repo-maturity-report.md',
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const original = readText(path);
    const major = manifest.pnpm.split('.')[0];
    const normalized = path.endsWith('compatibility.md')
      ? original.replace(new RegExp(String.raw`${major}\.\d+\.\d+`, 'g'), manifest.pnpm)
      : original;
    const updated = replacePnpmMentions(normalized, manifest.pnpm);
    writeOrExpect(path, original, updated);
  }
}

function writeOrExpectToolchainContract(path, expected) {
  const actual = existsSync(path) ? readText(path) : '';
  if (actual.replaceAll('\r\n', '\n') === expected) return;
  if (write) {
    writeFileSync(path, expected);
    return;
  }
  failures.push(`${path}: deterministic toolchain contract does not match ${manifestPath}`);
}

function syncDeterministicToolchainContract(manifest) {
  writeOrExpectToolchainContract(
    'mise.toml',
    `[tools]\nnode = "${manifest.node}"\n\n[settings]\nnode.corepack = true\n`,
  );
  writeOrExpectToolchainContract(
    '.husky/pre-commit',
    '#!/usr/bin/env sh\n\nnode scripts/run-pnpm.mjs run lint:staged\n',
  );
  writeOrExpectToolchainContract(
    '.husky/pre-push',
    '#!/usr/bin/env sh\n\nnode scripts/run-pnpm.mjs run check:pre-push\n',
  );
}

function syncCompatibilityToolchainStep(path) {
  const original = readText(path);
  const jobMatch = /^ {2}compatibility-smoke:\s*(?:#.*)?$/m.exec(original);
  if (!jobMatch) {
    failures.push(`${path}: deterministic toolchain contract is missing compatibility-smoke`);
    return;
  }
  const jobStart = jobMatch.index;
  const remainder = original.slice(jobStart + jobMatch[0].length + 1);
  const nextJob = /^ {2}[A-Za-z0-9_-]+:\s*(?:#.*)?$/m.exec(remainder);
  const jobEnd =
    nextJob === null ? original.length : jobStart + jobMatch[0].length + 1 + nextJob.index;
  const block = original.slice(jobStart, jobEnd);
  const command = '      - run: corepack pnpm run toolchain:check';
  if (block.includes(command)) return;

  const lintCommand = '      - run: pnpm run lint:identity';
  const insertion = block.indexOf(lintCommand);
  if (insertion < 0) {
    failures.push(
      `${path}: deterministic toolchain contract cannot place the doctor before lint:identity`,
    );
    return;
  }
  const updatedBlock = `${block.slice(0, insertion)}${command}\n${block.slice(insertion)}`;
  const updated = `${original.slice(0, jobStart)}${updatedBlock}${original.slice(jobEnd)}`;
  if (write) writeFileSync(path, updated);
  else failures.push(`${path}: deterministic toolchain contract must run the toolchain doctor`);
}

function validateSetupActionToolchainContract(path) {
  const action = readText(path);
  const required = [
    'corepack pnpm --version',
    'direct_pnpm_version="$(pnpm --version)"',
    'direct_pnpm_version}" != "${corepack_pnpm_version',
    'corepack pnpm store path --silent',
    'run: corepack pnpm install --frozen-lockfile',
  ];
  for (const snippet of required) {
    if (!action.includes(snippet)) {
      failures.push(`${path}: deterministic toolchain contract is missing ${snippet}`);
    }
  }
  if (action.includes('run: pnpm install --frozen-lockfile')) {
    failures.push(`${path}: dependency installation must use explicit Corepack pnpm`);
  }
}

function stripYamlScalar(value) {
  return value
    .trim()
    .replace(/\s+#.*$/, '')
    .replace(/^['"]|['"]$/g, '');
}

function completeCompatibilityRow(row, path) {
  if (!row) return undefined;
  const missing = ['os', 'runner', 'node'].filter((key) => !row[key]);
  if (missing.length > 0) {
    failures.push(`${path}: compatibility matrix row missing ${missing.join(', ')}`);
    return undefined;
  }
  return row;
}

function lineIndent(line) {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

function readCompatibilityMatrix(path) {
  const rows = [];
  let inCompatibilityJob = false;
  let compatibilityJobIndent = 0;
  let inStrategy = false;
  let strategyIndent;
  let inMatrix = false;
  let matrixIndent;
  let inInclude = false;
  let includeIndent;
  let current;

  const completeCurrent = () => {
    const completed = completeCompatibilityRow(current, path);
    if (completed) rows.push(completed);
    current = undefined;
  };

  for (const line of readText(path).split(/\r?\n/)) {
    const compatibilityJobMatch = /^(\s*)compatibility-smoke:\s*(?:#.*)?$/.exec(line);
    if (compatibilityJobMatch) {
      inCompatibilityJob = true;
      compatibilityJobIndent = compatibilityJobMatch[1].length;
      continue;
    }
    if (inCompatibilityJob && /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line)) {
      completeCurrent();
      break;
    }
    if (!inCompatibilityJob) continue;

    const indent = lineIndent(line);
    if (line.trim() !== '') {
      if (inInclude && includeIndent !== undefined && indent <= includeIndent) {
        completeCurrent();
        inInclude = false;
        includeIndent = undefined;
      }
      if (inMatrix && matrixIndent !== undefined && indent <= matrixIndent) {
        inMatrix = false;
        matrixIndent = undefined;
      }
      if (inStrategy && strategyIndent !== undefined && indent <= strategyIndent) {
        inStrategy = false;
        strategyIndent = undefined;
      }
    }

    const strategyMatch = /^(\s+)strategy:\s*(?:#.*)?$/.exec(line);
    if (strategyMatch && strategyMatch[1].length === compatibilityJobIndent + 2) {
      inStrategy = true;
      strategyIndent = strategyMatch[1].length;
      continue;
    }

    const matrixMatch = /^(\s+)matrix:\s*(?:#.*)?$/.exec(line);
    if (matrixMatch && inStrategy && matrixMatch[1].length === strategyIndent + 2) {
      inMatrix = true;
      matrixIndent = matrixMatch[1].length;
      continue;
    }

    const includeMatch = /^(\s+)include:\s*(?:#.*)?$/.exec(line);
    if (includeMatch && inMatrix && includeMatch[1].length === matrixIndent + 2) {
      inInclude = true;
      includeIndent = includeMatch[1].length;
      continue;
    }
    if (!inInclude) continue;

    if (
      includeIndent !== undefined &&
      line.trim() !== '' &&
      lineIndent(line) <= includeIndent &&
      /^\s*[A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line)
    ) {
      completeCurrent();
      inInclude = false;
      includeIndent = undefined;
      continue;
    }

    const itemMatch =
      includeIndent !== undefined && indent > includeIndent
        ? /^\s+-\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line)
        : undefined;
    if (itemMatch) {
      completeCurrent();
      current = {};
      if (compatibilityMatrixKeys.has(itemMatch[1])) {
        current[itemMatch[1]] = stripYamlScalar(itemMatch[2]);
      }
      continue;
    }

    const keyMatch =
      includeIndent !== undefined && indent > includeIndent
        ? /^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line)
        : undefined;
    if (keyMatch && current && compatibilityMatrixKeys.has(keyMatch[1])) {
      current[keyMatch[1]] = stripYamlScalar(keyMatch[2]);
    }
  }

  completeCurrent();
  if (rows.length === 0) failures.push(`${path}: compatibility matrix include rows not found`);
  return rows;
}

function compatibilityContext(row) {
  return `CI / compatibility-smoke (${row.os}, node ${row.node})`;
}

function compatibilityContextOs(context) {
  return /^CI \/ compatibility-smoke \(([^,]+), node [^)]+\)$/.exec(context)?.[1];
}

function readRulesetCompatibilityContexts(path) {
  const ruleset = readJson(path);
  const statusRule = ruleset.rules?.find((rule) => rule.type === 'required_status_checks');
  const contexts = statusRule?.parameters?.required_status_checks ?? [];
  if (!Array.isArray(contexts)) {
    failures.push(`${path}: required_status_checks must be an array`);
    return [];
  }
  return contexts
    .map((entry) => entry?.context)
    .filter(
      (context) => typeof context === 'string' && context.startsWith(compatibilityContextPrefix),
    );
}

function syncRulesetCompatibilityContexts(path, expectedContexts) {
  const original = readText(path);
  const ruleset = JSON.parse(original);
  const statusRule = ruleset.rules?.find((rule) => rule.type === 'required_status_checks');
  const contexts = statusRule?.parameters?.required_status_checks;
  if (!Array.isArray(contexts)) {
    failures.push(`${path}: required_status_checks must be an array`);
    return;
  }

  const firstCompatibilityIndex = contexts.findIndex((entry) =>
    entry?.context?.startsWith(compatibilityContextPrefix),
  );
  const nonCompatibilityContexts = contexts.filter(
    (entry) => !entry?.context?.startsWith(compatibilityContextPrefix),
  );
  const existingCompatibilityContexts = contexts.filter((entry) =>
    entry?.context?.startsWith(compatibilityContextPrefix),
  );
  const existingCompatibilityByOs = new Map();
  for (const entry of existingCompatibilityContexts) {
    const os = compatibilityContextOs(entry.context);
    if (os && !existingCompatibilityByOs.has(os)) existingCompatibilityByOs.set(os, entry);
  }
  const compatibilityContexts = expectedContexts.map((context, index) => {
    const os = compatibilityContextOs(context);
    const source =
      (os && existingCompatibilityByOs.get(os)) ?? existingCompatibilityContexts[index] ?? {};
    return { ...source, context };
  });
  const insertAt =
    firstCompatibilityIndex === -1 ? nonCompatibilityContexts.length : firstCompatibilityIndex;
  const updatedContexts = [
    ...nonCompatibilityContexts.slice(0, insertAt),
    ...compatibilityContexts,
    ...nonCompatibilityContexts.slice(insertAt),
  ];
  const current = contexts.map((entry) => entry?.context).filter(Boolean);
  const updated = updatedContexts.map((entry) => entry.context);
  if (JSON.stringify(current) === JSON.stringify(updated)) return;

  statusRule.parameters.required_status_checks = updatedContexts;
  writeOrExpect(path, original, normalizeJson(ruleset));
}

function syncBranchProtectionCompatibilityContexts(path, expectedContexts) {
  const original = readText(path);
  const expectedLines = expectedContexts.map((context) => `- \`${context}\``);
  const compatibilityLinePattern = /^- `CI \/ compatibility-smoke \([^)]+\)`$/;
  const filteredLines = [];
  let insertAt = -1;

  for (const line of original.split('\n')) {
    if (compatibilityLinePattern.test(line)) {
      if (insertAt === -1) insertAt = filteredLines.length;
      continue;
    }
    filteredLines.push(line);
  }

  if (insertAt === -1) insertAt = filteredLines.indexOf('- `Docs / build`');
  if (insertAt === -1) {
    insertAt = filteredLines.at(-1) === '' ? filteredLines.length - 1 : filteredLines.length;
    if (insertAt > 0 && filteredLines[insertAt - 1] !== '') {
      filteredLines.splice(insertAt, 0, '');
      insertAt += 1;
    }
  }

  filteredLines.splice(insertAt, 0, ...expectedLines);
  const updated = filteredLines.join('\n');
  writeOrExpect(path, original, updated);
}

function compareContextSets(path, actual, expected, label) {
  const missing = expected.filter((context) => !actual.includes(context));
  const extra = actual.filter((context) => !expected.includes(context));
  if (missing.length === 0 && extra.length === 0) return;
  failures.push(
    `${path}: ${label} compatibility contexts must match CI matrix job names` +
      `${missing.length > 0 ? `; missing ${missing.join(', ')}` : ''}` +
      `${extra.length > 0 ? `; extra ${extra.join(', ')}` : ''}`,
  );
}

function readBranchProtectionCompatibilityContexts(path) {
  return [...readText(path).matchAll(/- `(CI \/ compatibility-smoke \([^)]+\))`/g)].map(
    (match) => match[1],
  );
}

function validateCompatibilityConfiguration(manifest, rows, expectedContexts) {
  const manifestVersions = new Set(manifest.nodeCompatibility);
  for (const row of rows) {
    if (!manifestVersions.has(row.node)) {
      failures.push(
        `.github/workflows/ci.yml: compatibility matrix node ${row.node} is not present in ${manifestPath}`,
      );
    }
  }

  for (const version of manifest.nodeCompatibility) {
    if (!rows.some((row) => row.node === version)) {
      failures.push(`.github/workflows/ci.yml: compatibility matrix missing node ${version}`);
    }
  }

  for (const row of rows) {
    if (row.os !== 'ubuntu-latest' && row.node !== manifest.node) {
      failures.push(
        `.github/workflows/ci.yml: ${row.os} compatibility smoke must use primary node ${manifest.node}`,
      );
    }
  }

  compareContextSets(
    '.github/rulesets/main.json',
    readRulesetCompatibilityContexts('.github/rulesets/main.json'),
    expectedContexts,
    'required',
  );
  compareContextSets(
    'docs/release/branch-protection.md',
    readBranchProtectionCompatibilityContexts('docs/release/branch-protection.md'),
    expectedContexts,
    'documented',
  );
}

const manifest = readRuntimeManifest();
validateRuntimeManifest(manifest);

if (failures.length === 0) {
  syncTextFile('.node-version', `${manifest.node}\n`);
  syncTextFile('.nvmrc', `${manifest.node}\n`);
  syncWorkspacePnpm(manifest);
  syncDeterministicToolchainContract(manifest);
  syncCompatibilityToolchainStep('.github/workflows/ci.yml');
  validateSetupActionToolchainContract('.github/actions/setup-pnpm/action.yml');
  syncPnpmDockerMirrors(manifest);
  syncPnpmDocumentation(manifest);
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/workflows/docs.yml',
    '.github/workflows/publish.yml',
    '.github/workflows/release-please.yml',
    '.github/workflows/security.yml',
  ]) {
    syncWorkflowEnv(path, manifest);
  }
  syncGeneratedScaffoldRuntime(manifest);
  const failuresBeforeMatrixRead = failures.length;
  const compatibilityRows = readCompatibilityMatrix('.github/workflows/ci.yml');
  if (failures.length === failuresBeforeMatrixRead) {
    const expectedCompatibilityContexts = compatibilityRows.map(compatibilityContext);
    const failuresBeforeRulesetSync = failures.length;
    syncRulesetCompatibilityContexts('.github/rulesets/main.json', expectedCompatibilityContexts);
    if (!write || failures.length === failuresBeforeRulesetSync) {
      syncBranchProtectionCompatibilityContexts(
        'docs/release/branch-protection.md',
        expectedCompatibilityContexts,
      );
      validateCompatibilityConfiguration(
        manifest,
        compatibilityRows,
        expectedCompatibilityContexts,
      );
    }
  }
}

if (failures.length > 0) fail('Runtime version check failed.', failures);
