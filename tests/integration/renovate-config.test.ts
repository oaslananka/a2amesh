import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateRenovatePolicy } from '../../scripts/check-renovate-config.mjs';

const labels = new Set([
  'priority:P1',
  'priority:P2',
  'type:task',
  'type:security',
  'area:ci',
  'area:deps',
  'area:dx',
  'status:triaged',
]);

function validConfig() {
  return {
    baseBranchPatterns: ['main'],
    timezone: 'Europe/Istanbul',
    labels: ['area:deps', 'type:task'],
    automerge: false,
    prHourlyLimit: 3,
    prConcurrentLimit: 6,
    minimumReleaseAge: '3 days',
    internalChecksFilter: 'strict',
    prCreation: 'not-pending',
    lockFileMaintenance: { enabled: true },
    customManagers: [
      {
        customType: 'regex',
        managerFilePatterns: ['/^\\.github\\/workflows\\/security\\.yml$/'],
        matchStrings: ['GITLEAKS_VERSION'],
        datasourceTemplate: 'github-releases',
        depNameTemplate: 'gitleaks/gitleaks',
      },
      {
        customType: 'regex',
        managerFilePatterns: ['/^\\.github\\/workflows\\/security\\.yml$/'],
        matchStrings: ['ACTIONLINT_VERSION'],
        datasourceTemplate: 'github-releases',
        depNameTemplate: 'rhysd/actionlint',
      },
      {
        customType: 'regex',
        managerFilePatterns: ['/^\\.github\\/workflows\\/security\\.yml$/'],
        matchStrings: ['OSV_SCANNER_VERSION'],
        datasourceTemplate: 'github-releases',
        depNameTemplate: 'google/osv-scanner',
        versioningTemplate: 'loose',
      },
      {
        customType: 'regex',
        managerFilePatterns: ['/^\\.github\\/workflows\\/security\\.yml$/'],
        matchStrings: ['ZIZMOR_VERSION'],
        datasourceTemplate: 'github-releases',
        depNameTemplate: 'zizmorcore/zizmor',
      },
    ],
    packageRules: [
      {
        matchPackageNames: ['/^@a2amesh\\//'],
        enabled: false,
      },
      {
        matchUpdateTypes: ['major'],
        dependencyDashboardApproval: true,
        automerge: false,
        labels: ['priority:P1', 'type:task', 'area:deps'],
      },
      {
        matchManagers: ['github-actions', 'dockerfile', 'docker-compose'],
        pinDigests: true,
        automerge: false,
        labels: ['area:ci', 'area:deps', 'type:task'],
      },
    ],
    vulnerabilityAlerts: {
      enabled: true,
      labels: ['priority:P1', 'type:security', 'area:deps'],
    },
  };
}

function validGlobalConfig() {
  return {
    platform: 'github',
    repositories: ['oaslananka/a2amesh'],
    onboarding: false,
    requireConfig: 'required',
    branchPrefix: 'repository-managed-renovate/',
  };
}

const validWorkflow = `permissions:
  contents: read
jobs:
  validate:
    name: Renovate / validate
    steps:
      - uses: renovatebot/github-action@3064367f740a1a91cca218698a63902689cce200 # v46.1.20
        with:
          configurationFile: renovate.json
          docker-cmd-file: .github/renovate-validate.sh
          renovate-version: 43.272.4
          token: \${{ github.token }}
  renovate:
    needs: validate
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: renovatebot/github-action@3064367f740a1a91cca218698a63902689cce200 # v46.1.20
        with:
          renovate-version: 43.272.4
          token: \${{ github.token }}
`;

describe('Renovate policy validation', () => {
  it('accepts the project-specific least-privilege contract', () => {
    expect(
      validateRenovatePolicy({
        config: validConfig(),
        globalConfig: validGlobalConfig(),
        workflow: validWorkflow,
        repositoryLabels: labels,
      }),
    ).toEqual([]);
  });

  it('rejects unknown labels and automerge', () => {
    const config = validConfig();
    config.automerge = true;
    config.labels = ['area:unknown'];

    expect(
      validateRenovatePolicy({
        config,
        globalConfig: validGlobalConfig(),
        workflow: validWorkflow,
        repositoryLabels: labels,
      }),
    ).toEqual(
      expect.arrayContaining([
        'Renovate automerge must remain disabled',
        'Unknown Renovate label: area:unknown',
      ]),
    );
  });

  it('rejects missing lockfile maintenance and tool-version extraction', () => {
    const config = {
      ...validConfig(),
      lockFileMaintenance: undefined,
      customManagers: [],
    };

    expect(
      validateRenovatePolicy({
        config,
        globalConfig: validGlobalConfig(),
        workflow: validWorkflow,
        repositoryLabels: labels,
      }),
    ).toEqual(
      expect.arrayContaining([
        'Renovate lockFileMaintenance must be enabled',
        'Renovate must extract pinned security tool versions: GITLEAKS_VERSION, ACTIONLINT_VERSION, OSV_SCANNER_VERSION, ZIZMOR_VERSION',
      ]),
    );
  });

  it('rejects on-demand npx execution for the official validator', () => {
    const workflow = `${validWorkflow}
run: npx --yes --package=renovate@43.272.4 renovate-config-validator`;

    expect(
      validateRenovatePolicy({
        config: validConfig(),
        globalConfig: validGlobalConfig(),
        workflow,
        repositoryLabels: labels,
      }),
    ).toContain('Renovate workflow must validate with the pinned container instead of npx');
  });

  it('rejects write permissions at workflow scope', () => {
    const workflow = validWorkflow.replace('contents: read', 'contents: write');

    expect(
      validateRenovatePolicy({
        config: validConfig(),
        globalConfig: validGlobalConfig(),
        workflow,
        repositoryLabels: labels,
      }),
    ).toContain('Renovate workflow-level contents permission must remain read-only');
  });

  it('rejects broad repositories and unpinned workflow actions', () => {
    const globalConfig = validGlobalConfig();
    globalConfig.repositories = ['oaslananka/*'];

    expect(
      validateRenovatePolicy({
        config: validConfig(),
        globalConfig,
        workflow: validWorkflow.replaceAll('3064367f740a1a91cca218698a63902689cce200', 'v46.1.20'),
        repositoryLabels: labels,
      }),
    ).toEqual(
      expect.arrayContaining([
        'Repository-managed Renovate must target only oaslananka/a2amesh',
        'Renovate GitHub Action must be pinned to a full commit SHA',
      ]),
    );
  });

  it('validates the checked-in Renovate configuration and workflow', async () => {
    const [configText, globalText, workflow, labelsText] = await Promise.all([
      readFile(new URL('../../renovate.json', import.meta.url), 'utf8'),
      readFile(new URL('../../.github/renovate-global.json', import.meta.url), 'utf8'),
      readFile(new URL('../../.github/workflows/renovate.yml', import.meta.url), 'utf8'),
      readFile(new URL('../../.github/labels.yml', import.meta.url), 'utf8'),
    ]);
    const repositoryLabels = new Set(
      [...labelsText.matchAll(/^- name: ['"]([^'"]+)['"]$/gm)]
        .map((match) => match[1])
        .filter((label): label is string => typeof label === 'string'),
    );

    expect(
      validateRenovatePolicy({
        config: JSON.parse(configText),
        globalConfig: JSON.parse(globalText),
        workflow,
        repositoryLabels,
      }),
    ).toEqual([]);
  });
});
