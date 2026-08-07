import { describe, expect, it } from 'vitest';
import { validateSecurityTooling } from '../../scripts/check-security-tooling.mjs';

function validInputs() {
  return {
    preCommit: `rev: v8.30.1
rev: v1.170.0
- id: semgrep
  args: [--config=.semgrep.yml, --error, --metrics=off]
exclude: ^deploy/[h]elm/[^/]+/templates/
`,
    semgrepConfig: `rules:
  - id: a2amesh.node.no-child-process-shell-import
    severity: ERROR
  - id: a2amesh.node.no-shell-true
    severity: ERROR
  - id: a2amesh.node.no-disabled-tls-verification
    severity: ERROR
  - id: a2amesh.node.no-dynamic-evaluation
    severity: ERROR
`,
    securityWorkflow: `OSV_SCANNER_VERSION: 'v2.3.8'
SEMGREP_VERSION: '1.170.0'
name: Security / semgrep
name: Security / audit
pnpm audit --audit-level high
name: Security / osv
osv-scanner scan source --lockfile=pnpm-lock.yaml .
semgrep scan --config .semgrep.yml --error --disable-version-check --metrics=off
`,
    actionlintConfig: `paths:
  .github/workflows/dependency-freshness.yml:
    ignore:
      - 'unknown permission scope "vulnerability-alerts"'
`,
    securityPolicy: `Dependency advisories are detected within 24 hours. \`@oaslananka\` owns dependency advisory triage.`,
    dependencyFreshnessWorkflow: `name: Dependency Freshness
'on':
  schedule:
    - cron: '43 3 * * *'
  workflow_dispatch:
permissions:
  contents: read
  vulnerability-alerts: read
install: 'false'
cache: 'false'
corepack pnpm install --frozen-lockfile
curl -fsSLo osv-scanner https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_linux_amd64\nOSV_SCANNER_SHA256: 'bc98e15319ed0d515e3f9235287ba53cdc5535d576d24fd573978ecfe9ab92dc'\nprintf checksum | sha256sum --check --strict
pnpm audit --audit-level high --json
osv-scanner scan source --lockfile=pnpm-lock.yaml . --format json
gh api --paginate repos/example/dependabot/alerts?state=open
node scripts/check-dependency-freshness.mjs
`,
    workflows: {
      '.github/workflows/ci.yml': `permissions:
  contents: read
env:
  CODECOV_TOKEN: \${{ secrets.CODECOV_TOKEN }}
`,
      '.github/workflows/publish.yml': `permissions:
  contents: read
jobs:
  publish:
    if: github.repository == 'oaslananka/a2amesh' && github.ref == 'refs/heads/main'
    environment: npm-publish
    permissions:
      contents: read
      id-token: write
      attestations: write
`,
    },
    credentialInventory: {
      observed_at: '2026-07-23',
      settings_owner: '@oaslananka',
      refresh_cadence_days: 90,
      workflow_secrets: [
        {
          name: 'CODECOV_TOKEN',
          scope: 'repository',
          owner: '@oaslananka',
          purpose: 'Upload unit coverage and test-result reports to Codecov.',
          consumer: '.github/workflows/ci.yml',
          rotation: 'Rotate in Codecov, replace the GitHub secret, and revoke the previous token.',
        },
      ],
      environments: [
        {
          name: 'npm-publish',
          allowed_branches: ['main'],
          reviewers: ['@oaslananka'],
          prevent_self_review: false,
          auth_model: 'GitHub OIDC trusted publishing; no static npm credential.',
        },
      ],
    },
    packageJson: {
      scripts: {
        'security:semgrep': 'semgrep scan --config .semgrep.yml --error --metrics=off',
        'security:tooling:check': 'node scripts/check-security-tooling.mjs',
        'security:precommit': 'pre-commit run --all-files',
      } as Record<string, string>,
    },
    ruleset: JSON.stringify({
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [
              { context: 'Security / semgrep' },
              { context: 'Security / audit' },
              { context: 'Security / osv' },
            ],
          },
        },
      ],
    }),
  };
}

describe('repository-owned Semgrep policy', () => {
  it('accepts the pinned custom-rule-only contract', () => {
    expect(validateSecurityTooling(validInputs())).toEqual([]);
  });

  it('rejects stale pins and missing blocking rules', () => {
    const input = validInputs();
    input.preCommit = input.preCommit.replace('v1.170.0', 'v1.169.0');
    input.semgrepConfig = input.semgrepConfig.replace(
      '  - id: a2amesh.node.no-dynamic-evaluation\n    severity: ERROR\n',
      '',
    );
    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'pre-commit Semgrep must be pinned to v1.170.0',
        'Missing Semgrep rule: a2amesh.node.no-dynamic-evaluation',
      ]),
    );
  });

  it('rejects removed Snyk gates or broad Semgrep platform scans', () => {
    const input = validInputs();
    input.securityWorkflow += 'SNYK_VERSION: 1.1306.1\nsnyk code test\nsemgrep ci\n';
    input.packageJson.scripts['security:snyk'] = 'snyk test';
    input.ruleset = input.ruleset.replace('Security / semgrep', 'Snyk Security');
    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Security workflow must not reintroduce the removed Snyk gate',
        'Semgrep CI must remain limited to repository-owned custom rules',
        'Local scripts must not reintroduce the removed Snyk gate',
        'Repository ruleset must require Security / semgrep exactly once',
        'Repository ruleset must not require a removed Snyk check',
      ]),
    );
  });

  it('requires chart templates to use chart-aware validation', () => {
    const input = validInputs();
    input.preCommit = input.preCommit.replace('exclude: ^deploy/[h]elm/[^/]+/templates/\n', '');
    expect(validateSecurityTooling(input)).toContain(
      'generic YAML validation must exclude unrendered chart templates',
    );
  });

  it('rejects workflow secret references missing from the declared inventory', () => {
    const input = validInputs();
    input.workflows['.github/workflows/ci.yml'] +=
      'env:\n  UNDECLARED_TOKEN: ${{ secrets.UNDECLARED_TOKEN }}\n';

    expect(validateSecurityTooling(input)).toContain(
      'Workflow secret UNDECLARED_TOKEN is not documented in the credential inventory',
    );
  });

  it('requires complete ownership and rotation metadata for remaining secrets', () => {
    const input = validInputs();
    input.credentialInventory.workflow_secrets[0]!.rotation = '';

    expect(validateSecurityTooling(input)).toContain(
      'CODECOV_TOKEN: credential inventory must include a non-empty rotation path',
    );
  });

  it('requires the npm publish workflow to use the protected OIDC environment', () => {
    const input = validInputs();
    const npmSecret = ['NPM', 'TOKEN'].join('_');
    input.workflows['.github/workflows/publish.yml'] = `jobs:
  publish:
    environment: npm-publish
    env:
      ${npmSecret}: \${{ secrets.${npmSecret} }}
`;

    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Publish workflow must grant id-token: write for short-lived npm authentication',
        'Publish workflow must be restricted to canonical main',
        'Publish workflow must not reference long-lived npm credentials',
      ]),
    );
  });

  it('fails when the credential inventory exceeds its refresh cadence', () => {
    const input = validInputs();
    input.credentialInventory.observed_at = '2025-01-01';

    expect(validateSecurityTooling(input)).toContain(
      'Credential inventory observation is older than its refresh cadence',
    );
  });

  it('requires a read-only daily dependency freshness workflow at high severity', () => {
    const input = validInputs();
    input.dependencyFreshnessWorkflow = input.dependencyFreshnessWorkflow
      .replace("- cron: '43 3 * * *'\n", '')
      .replace('pnpm audit --audit-level high --json', 'pnpm audit --audit-level moderate --json')
      .replace('  vulnerability-alerts: read\n', '  vulnerability-alerts: write\n')
      .replace('  contents: read\n', '  contents: write\n');

    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Dependency freshness workflow must run at least daily',
        'Dependency freshness workflow must keep pnpm audit at high severity',
        'Dependency freshness workflow may only read vulnerability alerts',
        'Dependency freshness workflow must remain read-only',
      ]),
    );
  });

  it('requires a checksummed prebuilt OSV release matching the weekly security workflow', () => {
    const sourceBuildInput = validInputs();
    sourceBuildInput.dependencyFreshnessWorkflow =
      sourceBuildInput.dependencyFreshnessWorkflow.replace(
        `curl -fsSLo osv-scanner https://github.com/google/osv-scanner/releases/download/v2.3.8/osv-scanner_linux_amd64`,
        `go install "github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.3.8"`,
      );
    expect(validateSecurityTooling(sourceBuildInput)).toContain(
      'Dependency freshness workflow must download a literal prebuilt OSV-Scanner release',
    );

    const driftedInput = validInputs();
    driftedInput.dependencyFreshnessWorkflow = driftedInput.dependencyFreshnessWorkflow.replace(
      '/v2.3.8/osv-scanner_linux_amd64',
      '/v2.3.7/osv-scanner_linux_amd64',
    );
    expect(validateSecurityTooling(driftedInput)).toContain(
      'Dependency freshness OSV-Scanner pin must match the Security workflow',
    );

    const uncheckedInput = validInputs();
    uncheckedInput.dependencyFreshnessWorkflow = uncheckedInput.dependencyFreshnessWorkflow.replace(
      'sha256sum --check --strict',
      'echo unchecked',
    );
    expect(validateSecurityTooling(uncheckedInput)).toContain(
      'Dependency freshness workflow must verify the OSV-Scanner SHA-256 checksum',
    );
  });

  it('rejects release environments and provider credentials from the daily gate', () => {
    const input = validInputs();
    input.dependencyFreshnessWorkflow += `\nenvironment: npm-publish\nOPENAI_API_KEY: placeholder\n`;

    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Dependency freshness workflow must not use release or deployment environments',
        'Dependency freshness workflow must not use provider credentials',
      ]),
    );
  });

  it('keeps pull-request audit and OSV checks blocking in the main ruleset', () => {
    const input = validInputs();
    input.ruleset = input.ruleset
      .replace('{"context":"Security / audit"},', '')
      .replace('{"context":"Security / osv"}', '{"context":"Security / removed-osv"}');

    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Repository ruleset must require Security / audit exactly once',
        'Repository ruleset must require Security / osv exactly once',
      ]),
    );
  });

  it('keeps the actionlint schema-lag exception narrow and workflow-specific', () => {
    const input = validInputs();
    input.actionlintConfig = `paths:\n  .github/workflows/**/*.yml:\n    ignore:\n      - 'unknown permission scope ".*"'\n`;

    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Actionlint vulnerability-alerts exception must be scoped to dependency-freshness.yml',
        'Actionlint configuration must ignore only the known vulnerability-alerts schema lag',
        'Actionlint vulnerability-alerts exception must not be repository-wide',
      ]),
    );
  });

  it('requires dependency detection timing and triage ownership in the security policy', () => {
    const input = validInputs();
    input.securityPolicy = 'Dependency security policy without service-level targets.';

    expect(validateSecurityTooling(input)).toEqual(
      expect.arrayContaining([
        'Security policy must document the dependency advisory detection target',
        'Security policy must document the dependency advisory triage owner',
      ]),
    );
  });

  it('requires an owner for the manual settings refresh', () => {
    const input = validInputs();
    input.credentialInventory.settings_owner = '';

    expect(validateSecurityTooling(input)).toContain(
      'Credential inventory must include a non-empty settings owner',
    );
  });
});
