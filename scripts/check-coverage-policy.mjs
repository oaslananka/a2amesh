#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { coveragePolicy } from './coverage-policy.mjs';

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const PACKAGE_SOURCE_PATTERN = /^packages\/([^/]+)\/src\//;
const sortStrings = (left, right) => left.localeCompare(right);

export function validateCoveragePolicy(input) {
  const failures = [];
  validateSchemaAndInventory(input, failures);
  validatePackageEntries(input, failures);
  validateCriticalFiles(input, failures);
  validateExclusions(input.policy, failures);
  validateVitestContract(input.vitestConfig, failures);
  validatePackageScripts(input.packageJson, failures);
  validateCiContract(input.ciWorkflow, failures);
  return failures;
}

function validateSchemaAndInventory({ policy, activePackages }, failures) {
  if (policy?.schemaVersion !== 1) failures.push('Coverage policy schemaVersion must be 1');
  validateThresholds('aggregate', policy?.aggregate, failures);

  const configuredPackages = Object.keys(policy?.packages ?? {}).sort(sortStrings);
  const expectedPackages = [...activePackages].sort(sortStrings);
  for (const name of expectedPackages.filter((name) => !configuredPackages.includes(name))) {
    failures.push(`Active package missing from coverage inventory: ${name}`);
  }
  for (const name of configuredPackages.filter((name) => !expectedPackages.includes(name))) {
    failures.push(`Stale package in coverage inventory: ${name}`);
  }
}

function validatePackageEntries({ policy, existingPaths }, failures) {
  const roots = new Set();
  for (const [name, entry] of Object.entries(policy?.packages ?? {})) {
    const expectedRoot = `packages/${name}/src`;
    if (entry.root !== expectedRoot)
      failures.push(`Coverage root for ${name} must be ${expectedRoot}`);
    if (roots.has(entry.root)) failures.push(`Duplicate coverage root: ${entry.root}`);
    roots.add(entry.root);
    if (!existingPaths.has(entry.root))
      failures.push(`Coverage root does not exist: ${entry.root}`);
    validateThresholds(`package ${name}`, entry.thresholds, failures);
  }
}

function validateCriticalFiles({ policy, existingPaths }, failures) {
  const configuredPackages = Object.keys(policy?.packages ?? {});
  for (const [file, thresholds] of Object.entries(policy?.criticalFiles ?? {})) {
    if (!existingPaths.has(file)) failures.push(`Critical coverage file does not exist: ${file}`);
    const packageName = PACKAGE_SOURCE_PATTERN.exec(file)?.[1];
    if (!packageName || !configuredPackages.includes(packageName)) {
      failures.push(`Critical coverage file is outside the package inventory: ${file}`);
    }
    validateThresholds(`critical file ${file}`, thresholds, failures);
  }
}

function validateExclusions(policy, failures) {
  for (const exclusion of policy?.exclusions ?? []) {
    if (!exclusion.pattern || !exclusion.reason?.trim()) {
      failures.push('Every coverage exclusion must include a pattern and reason');
    }
  }
}

function validateVitestContract(vitestConfig, failures) {
  for (const required of [
    'coverageIncludePatterns',
    'coverageExcludePatterns',
    'coverageGlobalThresholds',
  ]) {
    if (!vitestConfig.includes(required))
      failures.push(`Vitest coverage config must use ${required}`);
  }
}

function validatePackageScripts(packageJson, failures) {
  const scripts = packageJson?.scripts ?? {};
  for (const script of ['coverage:inventory:check', 'coverage:report']) {
    if (typeof scripts[script] !== 'string' || scripts[script].length === 0) {
      failures.push(`Missing package script: ${script}`);
    }
  }
  for (const script of ['test:coverage', 'test:coverage:ci']) {
    if (!scripts[script]?.includes('coverage:inventory:check')) {
      failures.push(`${script} must validate the coverage inventory before execution`);
    }
    if (!scripts[script]?.includes('run-unit-coverage.mjs')) {
      failures.push(`${script} must use the coverage runner so reports survive threshold failures`);
    }
  }
}

function validateCiContract(ciWorkflow, failures) {
  for (const required of [
    'Publish package coverage summary',
    'GITHUB_STEP_SUMMARY',
    'Upload package coverage report',
    'coverage/package-summary.json',
    'coverage/package-summary.md',
    'if-no-files-found: error',
  ]) {
    if (!ciWorkflow.includes(required))
      failures.push(`CI coverage artifact is missing: ${required}`);
  }
}

function validateThresholds(label, thresholds, failures) {
  for (const metric of METRICS) {
    const value = thresholds?.[metric];
    if (!Number.isFinite(value) || value < 1 || value > 100) {
      failures.push(`${label} ${metric} threshold must be between 1 and 100`);
    }
  }
}

function listActivePackages() {
  return readdirSync('packages', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join('packages', name, 'package.json')))
    .filter((name) => existsSync(path.join('packages', name, 'src')))
    .filter((name) => hasRuntimeSource(path.join('packages', name, 'src')));
}

function hasRuntimeSource(root) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) return true;
    }
  }
  return false;
}

function listExistingPaths() {
  const paths = new Set();
  const pending = ['packages'];
  while (pending.length > 0) {
    const current = pending.pop();
    paths.add(current.replaceAll(path.sep, '/'));
    if (!statSync(current).isDirectory()) continue;
    for (const entry of readdirSync(current)) pending.push(path.join(current, entry));
  }
  return paths;
}

function runCli() {
  const failures = validateCoveragePolicy({
    policy: coveragePolicy,
    activePackages: listActivePackages(),
    existingPaths: listExistingPaths(),
    vitestConfig: readFileSync('vitest.config.ts', 'utf8'),
    packageJson: JSON.parse(readFileSync('package.json', 'utf8')),
    ciWorkflow: readFileSync('.github/workflows/ci.yml', 'utf8'),
  });
  if (failures.length > 0) {
    console.error('Coverage policy validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Coverage policy validation passed for ${listActivePackages().length} packages.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
