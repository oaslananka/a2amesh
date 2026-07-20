#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CANONICAL_REPOSITORY = 'oaslananka/a2amesh';
const RENOVATE_ACTION_SHA = '3064367f740a1a91cca218698a63902689cce200';
const RENOVATE_VERSION = '43.272.4';

export function validateRenovatePolicy({
  config,
  globalConfig,
  workflow,
  repositoryLabels,
}) {
  const failures = [];

  if (JSON.stringify(config.baseBranches) !== JSON.stringify(['main'])) {
    failures.push('Renovate baseBranches must contain only main');
  }
  if (config.timezone !== 'Europe/Istanbul') {
    failures.push('Renovate timezone must be Europe/Istanbul');
  }
  if (config.automerge !== false) failures.push('Renovate automerge must remain disabled');
  if (config.prHourlyLimit !== 3) failures.push('Renovate prHourlyLimit must be 3');
  if (config.prConcurrentLimit !== 6) failures.push('Renovate prConcurrentLimit must be 6');
  if (config.minimumReleaseAge !== '3 days') {
    failures.push('Renovate minimumReleaseAge must be 3 days');
  }
  if (config.internalChecksFilter !== 'strict') {
    failures.push('Renovate internalChecksFilter must be strict');
  }
  if (config.prCreation !== 'not-pending') {
    failures.push('Renovate prCreation must be not-pending');
  }

  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  const internalRule = packageRules.find((rule) =>
    rule.matchPackageNames?.includes('/^@a2amesh\\//'),
  );
  if (internalRule?.enabled !== false) {
    failures.push('Internal @a2amesh packages must remain disabled in Renovate');
  }
  const majorRule = packageRules.find((rule) => rule.matchUpdateTypes?.includes('major'));
  if (majorRule?.dependencyDashboardApproval !== true || majorRule?.automerge !== false) {
    failures.push('Major Renovate updates must require Dashboard approval without automerge');
  }
  const pinnedManagerRule = packageRules.find(
    (rule) =>
      rule.matchManagers?.includes('github-actions') &&
      rule.matchManagers?.includes('dockerfile') &&
      rule.matchManagers?.includes('docker-compose'),
  );
  if (pinnedManagerRule?.pinDigests !== true || pinnedManagerRule?.automerge !== false) {
    failures.push('Actions and container managers must remain pinned without automerge');
  }

  for (const label of collectLabels(config)) {
    if (!repositoryLabels.has(label)) failures.push(`Unknown Renovate label: ${label}`);
  }

  if (globalConfig.platform !== 'github') {
    failures.push('Self-hosted Renovate platform must be github');
  }
  if (JSON.stringify(globalConfig.repositories) !== JSON.stringify([CANONICAL_REPOSITORY])) {
    failures.push(`Self-hosted Renovate must target only ${CANONICAL_REPOSITORY}`);
  }
  if (globalConfig.onboarding !== false || globalConfig.requireConfig !== 'required') {
    failures.push('Self-hosted Renovate must require repository config without onboarding');
  }
  if (globalConfig.branchPrefix !== 'self-hosted-renovate/') {
    failures.push('Self-hosted Renovate branchPrefix must be self-hosted-renovate/');
  }

  if (!workflow.includes(`renovatebot/github-action@${RENOVATE_ACTION_SHA}`)) {
    failures.push('Renovate GitHub Action must be pinned to a full commit SHA');
  }
  if (!workflow.includes(`renovate-version: ${RENOVATE_VERSION}`)) {
    failures.push(`Renovate workflow must pin Renovate ${RENOVATE_VERSION}`);
  }
  if (!workflow.includes('token: ${{ github.token }}')) {
    failures.push('Renovate workflow must use the repository GitHub token');
  }
  for (const permission of ['contents: write', 'issues: write', 'pull-requests: write']) {
    if (!workflow.includes(permission)) {
      failures.push(`Renovate workflow missing permission: ${permission}`);
    }
  }
  if (/mount-docker-socket:\s*true/.test(workflow)) {
    failures.push('Renovate workflow must not mount the Docker socket');
  }

  return failures;
}

function collectLabels(config) {
  const labels = new Set();
  const add = (value) => {
    if (Array.isArray(value)) for (const label of value) labels.add(label);
  };
  add(config.labels);
  add(config.addLabels);
  add(config.vulnerabilityAlerts?.labels);
  for (const rule of config.packageRules ?? []) {
    add(rule.labels);
    add(rule.addLabels);
  }
  return labels;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readDeclaredLabels(path) {
  const content = readFileSync(path, 'utf8');
  return new Set([...content.matchAll(/^- name: ['"]([^'"]+)['"]$/gm)].map((match) => match[1]));
}

function runCli() {
  const failures = validateRenovatePolicy({
    config: readJson('renovate.json'),
    globalConfig: readJson('.github/renovate-global.json'),
    workflow: readFileSync('.github/workflows/renovate.yml', 'utf8'),
    repositoryLabels: readDeclaredLabels('.github/labels.yml'),
  });
  if (failures.length > 0) {
    console.error('Renovate policy validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Renovate policy validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
