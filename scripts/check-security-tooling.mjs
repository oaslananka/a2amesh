#!/usr/bin/env node
import { readFileSync } from 'node:fs';
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
}) {
  const failures = [];
  validatePreCommit(preCommit, failures);
  validateSemgrepConfig(semgrepConfig, failures);
  validateSecurityWorkflow(securityWorkflow, failures);
  validatePackageScripts(packageJson, failures);
  validateRuleset(ruleset, failures);
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
    'exclude: ^deploy/helm/[^/]+/templates/',
    'generic YAML validation must exclude unrendered Helm templates',
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
  });
  if (failures.length > 0) {
    console.error('Security tooling validation failed.');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Security tooling validation passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
