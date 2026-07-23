#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEMGREP_VERSION = '1.170.0';
const SEMGREP_CHECK = 'Security / semgrep';
const REQUIRED_RULES = [
  'a2amesh.node.no-child-process-shell-import',
  'a2amesh.node.no-shell-true',
  'a2amesh.node.no-disabled-tls-verification',
  'a2amesh.node.no-dynamic-evaluation',
];

export function validateSecurityTooling({
  preCommit,
  semgrepConfig,
  securityWorkflow,
  packageJson,
  ruleset,
  workflows = {},
  credentialInventory,
}) {
  const failures = [];
  validatePreCommit(preCommit, failures);
  validateSemgrepConfig(semgrepConfig, failures);
  validateSecurityWorkflow(securityWorkflow, failures);
  validatePackageScripts(packageJson, failures);
  validateRuleset(ruleset, failures);
  validateCredentialInventory(workflows, credentialInventory, failures);
  return failures;
}

function validatePreCommit(preCommit, failures) {
  requireText(preCommit, 'rev: v8.30.1', 'pre-commit Gitleaks must match CI v8.30.1', failures);
  requireText(
    preCommit,
    `rev: v${SEMGREP_VERSION}`,
    `pre-commit Semgrep must be pinned to v${SEMGREP_VERSION}`,
    failures,
  );
  for (const argument of ['--config=.semgrep.yml', '--error', '--metrics=off']) {
    requireText(preCommit, argument, `pre-commit Semgrep must include ${argument}`, failures);
  }
  requireText(
    preCommit,
    'exclude: ^deploy/[h]elm/[^/]+/templates/',
    'generic YAML validation must exclude unrendered chart templates',
    failures,
  );
}

function validateSemgrepConfig(semgrepConfig, failures) {
  for (const rule of REQUIRED_RULES) {
    requireText(semgrepConfig, `id: ${rule}`, `Missing Semgrep rule: ${rule}`, failures);
  }
  const errorRules = semgrepConfig.match(/severity:\s*ERROR/g) ?? [];
  if (errorRules.length !== REQUIRED_RULES.length) {
    failures.push('Every repository Semgrep rule must remain blocking severity ERROR');
  }
}

function validateSecurityWorkflow(workflow, failures) {
  requireText(
    workflow,
    `SEMGREP_VERSION: '${SEMGREP_VERSION}'`,
    `Security workflow must pin Semgrep ${SEMGREP_VERSION}`,
    failures,
  );
  requireText(
    workflow,
    'semgrep scan --config .semgrep.yml --error --disable-version-check --metrics=off',
    'Security workflow must run the repository-owned Semgrep policy',
    failures,
  );
  requireText(
    workflow,
    `name: ${SEMGREP_CHECK}`,
    'Security workflow must expose a stable Semgrep check',
    failures,
  );
  if (/\bsnyk\s+(test|code)|SNYK_(?:VERSION|TOKEN|PAT_TOKEN)/i.test(workflow)) {
    failures.push('Security workflow must not reintroduce the removed Snyk gate');
  }
  if (/semgrep ci|SEMGREP_APP_TOKEN/.test(workflow)) {
    failures.push('Semgrep CI must remain limited to repository-owned custom rules');
  }
}

function validatePackageScripts(packageJson, failures) {
  const scripts = packageJson?.scripts ?? {};
  for (const script of ['security:semgrep', 'security:tooling:check', 'security:precommit']) {
    if (typeof scripts[script] !== 'string' || scripts[script].length === 0) {
      failures.push(`Missing package script: ${script}`);
    }
  }
  if (scripts['security:snyk'] || scripts['security:snyk:code']) {
    failures.push('Local scripts must not reintroduce the removed Snyk gate');
  }
}

function validateRuleset(ruleset, failures) {
  let parsed;
  try {
    parsed = JSON.parse(ruleset);
  } catch {
    failures.push('Repository ruleset must be valid JSON');
    return;
  }

  const requiredRule = parsed.rules?.find((rule) => rule.type === 'required_status_checks');
  const contexts =
    requiredRule?.parameters?.required_status_checks?.map(({ context }) => context) ?? [];
  if (contexts.filter((context) => context === SEMGREP_CHECK).length !== 1) {
    failures.push('Repository ruleset must require Security / semgrep exactly once');
  }
  if (contexts.some((context) => /snyk/i.test(context))) {
    failures.push('Repository ruleset must not require a removed Snyk check');
  }
}

function validateCredentialInventory(workflows, inventory, failures) {
  if (!inventory || typeof inventory !== 'object') {
    failures.push('Credential inventory must be present and valid JSON');
    return;
  }

  validateInventoryMetadata(inventory, failures);
  const { repositorySecrets, secretNames } = validateRepositorySecretEntries(inventory, failures);
  const referencedSecrets = collectWorkflowSecretReferences(workflows, secretNames, failures);
  validateDeclaredConsumers(repositorySecrets, referencedSecrets, failures);
  validatePublishWorkflow(workflows?.['.github/workflows/publish.yml'] ?? '', failures);
  validatePublishEnvironment(inventory, failures);
}

function validateInventoryMetadata(inventory, failures) {
  if (
    typeof inventory.settings_owner !== 'string' ||
    inventory.settings_owner.trim().length === 0
  ) {
    failures.push('Credential inventory must include a non-empty settings owner');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inventory.observed_at ?? '')) {
    failures.push('Credential inventory must include an ISO observation date');
  }
  if (!isValidRefreshCadence(inventory.refresh_cadence_days)) {
    failures.push('Credential inventory refresh cadence must be between 1 and 90 days');
    return;
  }

  const observedAt = Date.parse(`${inventory.observed_at}T00:00:00Z`);
  if (!Number.isFinite(observedAt)) return;
  const ageDays = Math.floor((Date.now() - observedAt) / 86_400_000);
  if (ageDays > inventory.refresh_cadence_days) {
    failures.push('Credential inventory observation is older than its refresh cadence');
  }
}

function isValidRefreshCadence(value) {
  return Number.isInteger(value) && value >= 1 && value <= 90;
}

function validateRepositorySecretEntries(inventory, failures) {
  const repositorySecrets = Array.isArray(inventory.repository_secrets)
    ? inventory.repository_secrets
    : [];
  const secretNames = new Set();
  for (const secret of repositorySecrets) {
    validateRepositorySecretEntry(secret, secretNames, failures);
  }
  return { repositorySecrets, secretNames };
}

function validateRepositorySecretEntry(secret, secretNames, failures) {
  const name = typeof secret?.name === 'string' ? secret.name : '<unnamed>';
  if (secretNames.has(name)) failures.push(`${name}: credential inventory entry is duplicated`);
  secretNames.add(name);
  for (const [field, label] of [
    ['owner', 'owner'],
    ['purpose', 'purpose'],
    ['consumer', 'consumer'],
    ['rotation', 'rotation path'],
  ]) {
    if (typeof secret?.[field] !== 'string' || secret[field].trim().length === 0) {
      failures.push(`${name}: credential inventory must include a non-empty ${label}`);
    }
  }
}

function collectWorkflowSecretReferences(workflows, secretNames, failures) {
  const referencedSecrets = new Map();
  for (const [path, workflow] of Object.entries(workflows ?? {})) {
    validateWorkflowSecretReferences(path, workflow, secretNames, referencedSecrets, failures);
  }
  return referencedSecrets;
}

function validateWorkflowSecretReferences(
  path,
  workflow,
  secretNames,
  referencedSecrets,
  failures,
) {
  if (typeof workflow !== 'string') return;
  const references = [...workflow.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)];
  for (const [, name] of references) {
    const paths = referencedSecrets.get(name) ?? [];
    paths.push(path);
    referencedSecrets.set(name, paths);
    if (!secretNames.has(name)) {
      failures.push(`Workflow secret ${name} is not documented in the credential inventory`);
    }
  }
  if (/pull_request_target:/.test(workflow) && references.length > 0) {
    failures.push(`${path}: pull_request_target workflow must not reference repository secrets`);
  }
  if (/permissions:\s*write-all/.test(workflow)) {
    failures.push(`${path}: workflow must not grant write-all permissions`);
  }
}

function validateDeclaredConsumers(repositorySecrets, referencedSecrets, failures) {
  for (const secret of repositorySecrets) {
    const paths = referencedSecrets.get(secret.name) ?? [];
    if (!paths.includes(secret.consumer)) {
      failures.push(
        `${secret.name}: declared consumer ${secret.consumer} does not reference the secret`,
      );
    }
  }
}

function validatePublishWorkflow(publishWorkflow, failures) {
  if (!/environment:\s*npm-publish/.test(publishWorkflow)) {
    failures.push('Publish workflow must use the npm-publish environment');
  }
  if (!/id-token:\s*write/.test(publishWorkflow)) {
    failures.push('Publish workflow must grant id-token: write for short-lived npm authentication');
  }
  if (
    !publishWorkflow.includes(
      "if: github.repository == 'oaslananka/a2amesh' && github.ref == 'refs/heads/main'",
    )
  ) {
    failures.push('Publish workflow must be restricted to canonical main');
  }
  if (
    /secrets\.(?:NPM_TOKEN|NODE_AUTH_TOKEN)|(?:NPM_TOKEN|NODE_AUTH_TOKEN):/.test(publishWorkflow)
  ) {
    failures.push('Publish workflow must not reference long-lived npm credentials');
  }
}

function validatePublishEnvironment(inventory, failures) {
  const environments = Array.isArray(inventory.environments) ? inventory.environments : [];
  const npmEnvironment = environments.find((environment) => environment?.name === 'npm-publish');
  if (!npmEnvironment) {
    failures.push('Credential inventory must document the npm-publish environment');
    return;
  }
  if (!npmEnvironment.allowed_branches?.includes('main')) {
    failures.push('npm-publish environment must restrict deployments to main');
  }
  if (!Array.isArray(npmEnvironment.reviewers) || npmEnvironment.reviewers.length === 0) {
    failures.push('npm-publish environment must document at least one reviewer');
  }
  if (!/OIDC/i.test(npmEnvironment.auth_model ?? '')) {
    failures.push('npm-publish environment must document OIDC authentication');
  }
}

function requireText(content, expected, message, failures) {
  if (!content.includes(expected)) failures.push(message);
}

function runCli() {
  const failures = validateSecurityTooling({
    preCommit: readFileSync('.pre-commit-config.yaml', 'utf8'),
    semgrepConfig: readFileSync('.semgrep.yml', 'utf8'),
    securityWorkflow: readFileSync('.github/workflows/security.yml', 'utf8'),
    packageJson: JSON.parse(readFileSync('package.json', 'utf8')),
    ruleset: readFileSync('.github/rulesets/main.json', 'utf8'),
    workflows: Object.fromEntries(
      readdirSync('.github/workflows')
        .filter((file) => /\.ya?ml$/.test(file))
        .map((file) => [
          `.github/workflows/${file}`,
          readFileSync(`.github/workflows/${file}`, 'utf8'),
        ]),
    ),
    credentialInventory: JSON.parse(
      readFileSync('docs/security/github-actions-access-inventory.json', 'utf8'),
    ),
  });
  if (failures.length > 0) {
    console.error('Security tooling validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Security tooling validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
