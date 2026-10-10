import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const INTERNAL_PACKAGE_PATTERN = String.raw`/^@a2amesh\//`;
const SECURITY_TOOL_POLICIES = [
  {
    variable: 'GITLEAKS_VERSION',
    datasource: 'github-releases',
    depName: 'gitleaks/gitleaks',
  },
  {
    variable: 'ACTIONLINT_VERSION',
    datasource: 'github-releases',
    depName: 'rhysd/actionlint',
  },
  {
    variable: 'OSV_SCANNER_VERSION',
    datasource: 'github-releases',
    depName: 'google/osv-scanner',
  },
  {
    variable: 'ZIZMOR_VERSION',
    datasource: 'github-releases',
    depName: 'zizmorcore/zizmor',
  },
  {
    variable: 'SEMGREP_VERSION',
    datasource: 'pypi',
    depName: 'semgrep',
  },
];

export function validateRenovatePolicy({
  config,
  repositoryLabels,
  ciWorkflow,
  mergify,
  hasLegacyRunner = false,
}) {
  const failures = [];
  validateRepositoryConfig(config, failures);
  validatePackageRules(config, failures);
  validateSecurityToolManagers(config, failures);
  validateDependencyFreshnessOsvManager(config, failures);
  validateCodecovToolManager(config, failures);
  validatePnpmPolicy(config, failures);
  validateLabels(config, repositoryLabels, failures);
  validateHostedAppContract({ ciWorkflow, mergify, hasLegacyRunner }, failures);
  return failures;
}

function validateRepositoryConfig(config, failures) {
  if (JSON.stringify(config.baseBranchPatterns) !== JSON.stringify(['main'])) {
    failures.push('Renovate baseBranchPatterns must contain only main');
  }
  if (config.timezone !== 'Europe/Istanbul') {
    failures.push('Renovate timezone must be Europe/Istanbul');
  }
  if (config.automerge !== false) failures.push('Renovate automerge must remain disabled');
  if (config.prHourlyLimit !== 2) failures.push('Renovate prHourlyLimit must be 2');
  if (config.prConcurrentLimit !== 2) failures.push('Renovate prConcurrentLimit must be 2');
  if (config.branchConcurrentLimit !== 2) failures.push('Renovate branchConcurrentLimit must be 2');
  if (config.commitHourlyLimit !== 2) failures.push('Renovate commitHourlyLimit must be 2');
  if (config.minimumReleaseAge !== '3 days') {
    failures.push('Renovate minimumReleaseAge must be 3 days');
  }
  if (config.internalChecksFilter !== 'strict') {
    failures.push('Renovate internalChecksFilter must be strict');
  }
  if (config.prCreation !== 'not-pending') {
    failures.push('Renovate prCreation must be not-pending');
  }
  if (config.postUpdateOptions?.includes('pnpmDedupe') !== true) {
    failures.push('Renovate must keep pnpmDedupe enabled after lockfile updates');
  }
  if (config.vulnerabilityAlerts?.enabled !== true) {
    failures.push('Hosted Renovate must consume GitHub Dependabot vulnerability alerts');
  }
  if (config.osvVulnerabilityAlerts !== true) {
    failures.push('Renovate OSV vulnerability alerts must remain enabled');
  }
  if (config.lockFileMaintenance?.enabled !== true) {
    failures.push('Renovate lockFileMaintenance must be enabled');
  }
  if (config.dependencyDashboard !== true) {
    failures.push('Renovate Dependency Dashboard must be explicitly enabled');
  }
  if (config.dependencyDashboardTitle !== 'Dependency Dashboard') {
    failures.push('Renovate Dependency Dashboard title must remain stable');
  }
}

function validatePackageRules(config, failures) {
  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  const internalRule = packageRules.find((rule) =>
    rule.matchPackageNames?.includes(INTERNAL_PACKAGE_PATTERN),
  );
  if (internalRule?.enabled !== false) {
    failures.push('Internal @a2amesh packages must remain disabled in Renovate');
  }

  const majorRule = packageRules.find((rule) => rule.matchUpdateTypes?.includes('major'));
  if (majorRule?.dependencyDashboardApproval !== true || majorRule?.automerge !== false) {
    failures.push('Major Renovate updates must require Dashboard approval without automerge');
  }

  const pinnedManagerRule = packageRules.find((rule) => hasPinnedManagerSet(rule.matchManagers));
  if (pinnedManagerRule?.pinDigests !== true || pinnedManagerRule?.automerge !== false) {
    failures.push('Actions and container managers must remain pinned without automerge');
  }
}

function hasPinnedManagerSet(managers) {
  return (
    managers?.includes('github-actions') === true &&
    managers.includes('dockerfile') &&
    managers.includes('docker-compose')
  );
}

function validateSecurityToolManagers(config, failures) {
  const managers = Array.isArray(config.customManagers) ? config.customManagers : [];
  const missing = SECURITY_TOOL_POLICIES.filter(
    (policy) => !managers.some((manager) => matchesSecurityToolManager(manager, policy)),
  );
  if (missing.length > 0) {
    failures.push(
      `Renovate must extract pinned security tool versions: ${missing.map(({ variable }) => variable).join(', ')}`,
    );
  }
}

function matchesSecurityToolManager(manager, policy) {
  return (
    manager.customType === 'regex' &&
    manager.managerFilePatterns?.some(isSecurityWorkflowPattern) === true &&
    manager.datasourceTemplate === policy.datasource &&
    manager.depNameTemplate === policy.depName &&
    manager.matchStrings?.some((pattern) => pattern.includes(policy.variable)) === true
  );
}

function isSecurityWorkflowPattern(pattern) {
  return pattern.includes('workflows') && pattern.includes('security');
}

function validateDependencyFreshnessOsvManager(config, failures) {
  const managers = Array.isArray(config.customManagers) ? config.customManagers : [];
  const manager = managers.find(
    (candidate) =>
      candidate.customType === 'regex' &&
      candidate.datasourceTemplate === 'github-releases' &&
      candidate.depNameTemplate === 'google/osv-scanner',
  );
  const managesDailyWorkflow =
    manager?.managerFilePatterns?.some((pattern) => pattern.includes('dependency-freshness')) ===
    true;
  const extractsLiteralPin =
    manager?.matchStrings?.some((pattern) => pattern.includes('releases/download/')) === true;
  if (!managesDailyWorkflow || !extractsLiteralPin) {
    failures.push('Renovate must update the daily OSV-Scanner literal pin');
  }
}

function validateCodecovToolManager(config, failures) {
  const managers = Array.isArray(config.customManagers) ? config.customManagers : [];
  const hasCodecovManager = managers.some(
    (manager) =>
      manager.customType === 'regex' &&
      manager.managerFilePatterns?.some(
        (pattern) => pattern.includes('workflows') && pattern.includes('ci'),
      ) === true &&
      manager.datasourceTemplate === 'github-releases' &&
      manager.depNameTemplate === 'codecov/codecov-cli' &&
      manager.matchStrings?.some((pattern) => pattern.includes('CODECOV_CLI_VERSION')) === true,
  );
  if (!hasCodecovManager) {
    failures.push('Renovate must extract the pinned Codecov CLI version');
  }
}

function validatePnpmPolicy(config, failures) {
  const managers = Array.isArray(config.customManagers) ? config.customManagers : [];
  const hasPnpmManager = managers.some(
    (manager) =>
      manager.customType === 'regex' &&
      manager.depNameTemplate === 'pnpm' &&
      manager.datasourceTemplate === 'npm' &&
      manager.managerFilePatterns?.some((pattern) => pattern.includes('runtime-versions')) === true,
  );
  if (!hasPnpmManager) failures.push('Renovate must extract the pnpm runtime source of truth');

  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  if (packageRules.some((rule) => rule.postUpgradeTasks != null)) {
    failures.push('Hosted Renovate must not rely on unapproved arbitrary postUpgradeTasks');
  }

  const pnpmRule = packageRules.find(
    (rule) => rule.matchPackageNames?.includes('pnpm') && rule.groupName === 'pnpm toolchain',
  );
  if (pnpmRule?.dependencyDashboardApproval !== true || pnpmRule?.automerge !== false) {
    failures.push('Hosted Renovate pnpm toolchain updates need explicit Dashboard approval');
  }

  const hasInternalImageRule = packageRules.some(
    (rule) =>
      rule.enabled === false &&
      rule.matchDatasources?.includes('docker') &&
      rule.matchPackageNames?.some((name) => name.includes('ghcr') && name.includes('a2amesh-')),
  );
  if (!hasInternalImageRule) {
    failures.push('Repository-owned unpublished images must remain disabled in Renovate');
  }
}

function validateLabels(config, repositoryLabels, failures) {
  for (const label of collectLabels(config)) {
    if (!repositoryLabels.has(label)) failures.push(`Unknown Renovate label: ${label}`);
  }
}

function validateHostedAppContract({ ciWorkflow, mergify, hasLegacyRunner }, failures) {
  if (hasLegacyRunner) {
    failures.push('Repository-managed Renovate Action must not coexist with the hosted App');
  }
  if (!ciWorkflow.includes('renovate/*') || ciWorkflow.includes('repository-managed-renovate/*')) {
    failures.push('Hosted Renovate PRs must receive isolated clean-store dependency CI');
  }
  for (const contract of [
    'author = renovate[bot]',
    'head ~= ^renovate/',
    'label = automerge:enabled',
    '-label = risk:high',
    '-label = type:security',
  ]) {
    if (!mergify.includes(contract)) {
      failures.push('Hosted Renovate Mergify rule missing: ' + contract);
    }
  }
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
    repositoryLabels: readDeclaredLabels('.github/labels.yml'),
    ciWorkflow: readFileSync('.github/workflows/ci.yml', 'utf8'),
    mergify: readFileSync('.mergify.yml', 'utf8'),
    hasLegacyRunner: [
      '.github/workflows/renovate.yml',
      '.github/renovate-global.json',
      '.github/renovate-validate.sh',
    ].some((path) => existsSync(path)),
  });
  if (failures.length > 0) {
    console.error('Renovate policy validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Renovate policy validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
