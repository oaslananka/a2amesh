import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CANONICAL_REPOSITORY = 'oaslananka/a2amesh';
const RENOVATE_ACTION_SHA = '3064367f740a1a91cca218698a63902689cce200';
const RENOVATE_VERSION = '43.272.4';
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
  globalConfig,
  workflow,
  repositoryLabels,
  docsWorkflow,
  dependencyReviewWorkflow,
  dispatchScript,
}) {
  const failures = [];
  validateRepositoryConfig(config, failures);
  validatePackageRules(config, failures);
  validateSecurityToolManagers(config, failures);
  validateCodecovToolManager(config, failures);
  validatePnpmPolicy(config, failures);
  validateLabels(config, repositoryLabels, failures);
  validateGlobalConfig(globalConfig, failures);
  validateWorkflow(workflow, failures);
  validateDispatchContract({ docsWorkflow, dependencyReviewWorkflow, dispatchScript }, failures);
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
  const pnpmRule = packageRules.find(
    (rule) => rule.matchPackageNames?.includes('pnpm') && rule.groupName === 'pnpm toolchain',
  );
  const postUpgradeTasks = pnpmRule?.postUpgradeTasks;
  if (
    postUpgradeTasks?.commands?.includes('node scripts/check-runtime-versions.mjs --write') !==
      true ||
    postUpgradeTasks.executionMode !== 'branch'
  ) {
    failures.push('Renovate pnpm updates must run the runtime-version synchronizer');
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

function validateGlobalConfig(globalConfig, failures) {
  if (globalConfig.platform !== 'github') {
    failures.push('Repository-managed Renovate platform must be github');
  }
  if (JSON.stringify(globalConfig.repositories) !== JSON.stringify([CANONICAL_REPOSITORY])) {
    failures.push(`Repository-managed Renovate must target only ${CANONICAL_REPOSITORY}`);
  }
  if (globalConfig.onboarding !== false || globalConfig.requireConfig !== 'required') {
    failures.push('Repository-managed Renovate must require repository config without onboarding');
  }
  if (globalConfig.branchPrefix !== 'repository-managed-renovate/') {
    failures.push('Repository-managed Renovate branchPrefix must be repository-managed-renovate/');
  }
  if (
    JSON.stringify(globalConfig.allowedCommands) !==
    JSON.stringify([String.raw`^node scripts/check-runtime-versions\.mjs --write$`])
  ) {
    failures.push(
      'Repository-managed Renovate must allow only the runtime-version synchronizer command',
    );
  }
}

function validateWorkflow(workflow, failures) {
  if (countOccurrences(workflow, `renovatebot/github-action@${RENOVATE_ACTION_SHA}`) < 2) {
    failures.push('Renovate GitHub Action must be pinned to a full commit SHA');
  }
  if (!workflow.includes(`renovate-version: ${RENOVATE_VERSION}`)) {
    failures.push(`Renovate workflow must pin Renovate ${RENOVATE_VERSION}`);
  }
  if (countOccurrences(workflow, 'token: ${{ github.token }}') < 2) {
    failures.push('Renovate workflow must use the repository GitHub token');
  }
  if (/\bnpx\b/.test(workflow)) {
    failures.push('Renovate workflow must validate with the pinned container instead of npx');
  }
  if (!workflow.includes('docker-cmd-file: .github/renovate-validate.sh')) {
    failures.push('Renovate workflow must use the pinned container validator entrypoint');
  }
  if (!workflow.includes('configurationFile: renovate.json')) {
    failures.push('Renovate validation job must mount renovate.json');
  }
  if (!workflow.includes('needs: validate')) {
    failures.push('Renovate execution job must depend on validation');
  }
  if (!workflow.includes('node scripts/dispatch-renovate-checks.mjs')) {
    failures.push('Renovate workflow must dispatch required checks after repository updates');
  }
  validateWorkflowPermissions(workflow, failures);
  if (/mount-docker-socket:\s*true/.test(workflow)) {
    failures.push('Renovate workflow must not mount the Docker socket');
  }
}

function validateWorkflowPermissions(workflow, failures) {
  const workflowPermissions = workflow.match(/^permissions:\n((?: {2}\S.*\n)+)/m)?.[1] ?? '';
  if (!/^ {2}contents: read$/m.test(workflowPermissions)) {
    failures.push('Renovate workflow-level contents permission must remain read-only');
  }
  if (/^ {2}\S+: write$/m.test(workflowPermissions)) {
    failures.push('Renovate workflow-level permissions must not grant write access');
  }

  const renovateJobPermissions =
    workflow.match(/^ {2}renovate:\n[\s\S]*?^ {4}permissions:\n((?: {6}\S.*\n)+)/m)?.[1] ?? '';
  for (const permission of [
    'contents: write',
    'issues: write',
    'pull-requests: write',
    'actions: write',
    'security-events: read',
  ]) {
    if (!renovateJobPermissions.includes(permission)) {
      failures.push(`Renovate job missing permission: ${permission}`);
    }
  }
}

function validateDispatchContract(
  { docsWorkflow, dependencyReviewWorkflow, dispatchScript },
  failures,
) {
  for (const value of ['workflow_dispatch:', 'deploy:', 'default: false', 'inputs.deploy']) {
    if (!docsWorkflow.includes(value)) {
      failures.push(`Docs workflow missing Renovate-safe dispatch contract: ${value}`);
    }
  }
  for (const value of [
    'workflow_dispatch:',
    'base_ref:',
    'head_ref:',
    'inputs.base_ref',
    'inputs.head_ref',
  ]) {
    if (!dependencyReviewWorkflow.includes(value)) {
      failures.push(`Dependency Review workflow missing dispatch contract: ${value}`);
    }
  }
  for (const value of [
    'repository-managed-renovate/',
    '.github/rulesets/main.json',
    'required_status_checks',
    "'ci.yml': 'CI / '",
    "'docs.yml': 'Docs / '",
    "'security.yml': 'Security / '",
    "'codeql.yml': 'CodeQL / '",
    "'scorecard.yml': 'Scorecard / '",
    "'dependency-review.yml': 'Dependency Review / '",
    'gh',
    'workflow',
    'run',
  ]) {
    if (!dispatchScript.includes(value)) {
      failures.push(`Renovate check dispatcher missing contract value: ${value}`);
    }
  }
}

function countOccurrences(content, value) {
  return content.split(value).length - 1;
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
    docsWorkflow: readFileSync('.github/workflows/docs.yml', 'utf8'),
    dependencyReviewWorkflow: readFileSync('.github/workflows/dependency-review.yml', 'utf8'),
    dispatchScript: readFileSync('scripts/dispatch-renovate-checks.mjs', 'utf8'),
  });
  if (failures.length > 0) {
    console.error('Renovate policy validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Renovate policy validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
