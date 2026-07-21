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
    securityWorkflow: `SEMGREP_VERSION: '1.170.0'
name: Security / semgrep
semgrep scan --config .semgrep.yml --error --disable-version-check --metrics=off
`,
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
          parameters: { required_status_checks: [{ context: 'Security / semgrep' }] },
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
});
