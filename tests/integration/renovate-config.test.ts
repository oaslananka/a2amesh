import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRenovatePolicy } from '../../scripts/check-renovate-config.mjs';

const read = (path: string) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

function fixture() {
  const labels = new Set(
    [...read('.github/labels.yml').matchAll(/^- name: ['"]([^'"]+)['"]$/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
  return {
    config: JSON.parse(read('renovate.json')),
    repositoryLabels: labels,
    ciWorkflow: read('.github/workflows/ci.yml'),
    mergify: read('.mergify.yml'),
  };
}

describe('hosted Renovate App policy', () => {
  it('accepts the real App configuration and protected CI/Mergify contract', () => {
    expect(validateRenovatePolicy(fixture())).toEqual([]);
  });

  it('rejects retaining the second repository-managed Renovate runner', () => {
    expect(validateRenovatePolicy({ ...fixture(), hasLegacyRunner: true })).toContain(
      'Repository-managed Renovate Action must not coexist with the hosted App',
    );
  });

  it('keeps the two-lane queue and three-day release-age gate', () => {
    const input = fixture();
    input.config.prConcurrentLimit = 6;
    input.config.branchConcurrentLimit = 6;
    input.config.prHourlyLimit = 6;
    input.config.commitHourlyLimit = 0;
    input.config.minimumReleaseAge = '0 days';
    expect(validateRenovatePolicy(input)).toEqual(
      expect.arrayContaining([
        'Renovate prHourlyLimit must be 2',
        'Renovate prConcurrentLimit must be 2',
        'Renovate branchConcurrentLimit must be 2',
        'Renovate commitHourlyLimit must be 2',
        'Renovate minimumReleaseAge must be 3 days',
      ]),
    );
  });

  it('requires Github Dependabot and OSV vulnerability detection for the hosted App', () => {
    const input = fixture();
    input.config.vulnerabilityAlerts.enabled = false;
    input.config.osvVulnerabilityAlerts = false;
    expect(validateRenovatePolicy(input)).toEqual(
      expect.arrayContaining([
        'Hosted Renovate must consume GitHub Dependabot vulnerability alerts',
        'Renovate OSV vulnerability alerts must remain enabled',
      ]),
    );
  });

  it('blocks unapproved post-upgrade commands on the hosted service', () => {
    const input = fixture();
    input.config.packageRules.push({ postUpgradeTasks: { commands: ['curl unknown.sh | sh'] } });
    expect(validateRenovatePolicy(input)).toContain(
      'Hosted Renovate must not rely on unapproved arbitrary postUpgradeTasks',
    );
  });

  it('requires pnpm toolchain changes to receive dashboard approval', () => {
    const input = fixture();
    const rule = input.config.packageRules.find(
      (candidate: { groupName?: string }) => candidate.groupName === 'pnpm toolchain',
    );
    rule.dependencyDashboardApproval = false;
    expect(validateRenovatePolicy(input)).toContain(
      'Hosted Renovate pnpm toolchain updates need explicit Dashboard approval',
    );
  });

  it('preserves internal workspace exclusion and major-update approval', () => {
    const input = fixture();
    input.config.packageRules.find((rule: { enabled?: boolean; matchPackageNames?: string[] }) =>
      rule.matchPackageNames?.includes('/^@a2amesh\\//'),
    ).enabled = true;
    input.config.packageRules.find((rule: { matchUpdateTypes?: string[] }) =>
      rule.matchUpdateTypes?.includes('major'),
    ).dependencyDashboardApproval = false;
    expect(validateRenovatePolicy(input)).toEqual(
      expect.arrayContaining([
        'Internal @a2amesh packages must remain disabled in Renovate',
        'Major Renovate updates must require Dashboard approval without automerge',
      ]),
    );
  });

  it('maintains security-tool pins and workspace pnpm extraction', () => {
    const input = fixture();
    input.config.customManagers = [];
    expect(validateRenovatePolicy(input)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Renovate must extract pinned security tool versions'),
        'Renovate must update the daily OSV-Scanner literal pin',
        'Renovate must extract the pinned Codecov CLI version',
        'Renovate must extract the pnpm runtime source of truth',
      ]),
    );
  });

  it('rejects missing hosted app bot author and branch in Mergify', () => {
    const input = fixture();
    input.mergify = input.mergify.replace('author = renovate[bot]', 'author = github-actions[bot]');
    input.mergify = input.mergify.replace('head ~= ^renovate/', 'head ~= ^other/');
    expect(validateRenovatePolicy(input)).toEqual(
      expect.arrayContaining([
        'Hosted Renovate Mergify rule missing: author = renovate[bot]',
        'Hosted Renovate Mergify rule missing: head ~= ^renovate/',
      ]),
    );
  });

  it('requires hosted app branches on isolated clean-install CI lane', () => {
    const input = fixture();
    input.ciWorkflow = input.ciWorkflow.replace('renovate/*', 'other/*');
    expect(validateRenovatePolicy(input)).toContain(
      'Hosted Renovate PRs must receive isolated clean-store dependency CI',
    );
  });

  it('keeps automerge disabled in Renovate and restricts Mergify security exceptions', () => {
    const input = fixture();
    input.config.automerge = true;
    input.mergify = input.mergify.replace('-label = type:security', '');
    expect(validateRenovatePolicy(input)).toEqual(
      expect.arrayContaining([
        'Renovate automerge must remain disabled',
        'Hosted Renovate Mergify rule missing: -label = type:security',
      ]),
    );
  });

  it('rejects labels not declared by the repository', () => {
    const input = fixture();
    input.config.labels = ['unregistered-label'];
    expect(validateRenovatePolicy(input)).toContain('Unknown Renovate label: unregistered-label');
  });
});
