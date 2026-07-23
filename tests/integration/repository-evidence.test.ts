import { describe, expect, it } from 'vitest';
import {
  injectRepositoryEvidence,
  renderRepositoryEvidence,
  validateMaturityReport,
  validateRepositoryEvidence,
} from '../../scripts/repository-evidence-core.mjs';

const packagePaths = [
  'packages/protocol',
  'packages/runtime',
  'packages/registry',
  'packages/mcp',
  'packages/cli',
  'packages/create-a2amesh',
];

function snapshot() {
  return {
    schema_version: 1,
    observed_at: '2026-07-23T21:05:00.000Z',
    refresh_cadence_days: 14,
    repository: {
      name: 'oaslananka/a2amesh',
      url: 'https://github.com/oaslananka/a2amesh',
      default_branch: 'main',
      visibility: 'public',
      archived: false,
      license: 'Apache-2.0',
      open_work: {
        issues: 15,
        pull_requests: 1,
        total: 16,
      },
    },
    release: {
      source_version: '0.13.0-alpha.1',
      package_paths: packagePaths,
      latest_github_release: null,
      latest_canonical_tag: {
        name: '@a2amesh/runtime-v0.13.0-alpha.1',
        commit: '40500530522890f372599a20d35bfad77d94b546',
      },
      npm: {
        package: '@a2amesh/runtime',
        alpha: '0.13.0-alpha.1',
        latest: '0.1.0-alpha.1',
      },
      active_release_pr: {
        number: 202,
        title: 'chore: release main',
        url: 'https://github.com/oaslananka/a2amesh/pull/202',
        proposed_version: '0.14.0-alpha.1',
      },
    },
    settings: [
      {
        name: 'Private vulnerability reporting',
        value: 'enabled',
        owner: '@oaslananka',
        observed_at: '2026-07-23',
        refresh_cadence_days: 90,
        source: 'GitHub REST API: private-vulnerability-reporting',
      },
      {
        name: 'npm-publish environment',
        value: 'main-only; required reviewer; OIDC; no static environment secret',
        owner: '@oaslananka',
        observed_at: '2026-07-23',
        refresh_cadence_days: 90,
        source: 'GitHub REST API: environments/npm-publish',
      },
    ],
    provenance: {
      repository: 'GitHub REST API: GET /repos/oaslananka/a2amesh',
      issues: 'GitHub CLI: issue list --state open',
      pull_requests: 'GitHub CLI: pr list --state open',
      releases: 'GitHub REST API: releases/latest and tags',
      npm: 'npm registry metadata for @a2amesh/runtime',
      source_versions: '.release-please-manifest.json and release-tracked package.json files',
    },
  };
}

function localState() {
  return {
    manifest: Object.fromEntries(packagePaths.map((path) => [path, '0.13.0-alpha.1'])),
    releaseConfig: {
      packages: Object.fromEntries(
        packagePaths.map((path) => [
          path,
          { 'package-name': `@a2amesh/${path.split('/').at(-1)}` },
        ]),
      ),
    },
    packageVersions: Object.fromEntries(packagePaths.map((path) => [path, '0.13.0-alpha.1'])),
  };
}

describe('repository evidence', () => {
  it('accepts fresh evidence aligned with linked package configuration', () => {
    expect(
      validateRepositoryEvidence(snapshot(), localState(), new Date('2026-07-30T00:00:00.000Z')),
    ).toEqual([]);
  });

  it('rejects evidence older than its repository refresh cadence', () => {
    expect(
      validateRepositoryEvidence(snapshot(), localState(), new Date('2026-08-07T21:05:01.000Z')),
    ).toContain('Repository evidence is older than its 14-day refresh cadence');
  });

  it('rejects source-version drift from the release manifest and package files', () => {
    const state = localState();
    state.manifest['packages/runtime'] = '0.14.0-alpha.1';
    state.packageVersions['packages/registry'] = '0.12.0-alpha.1';

    expect(
      validateRepositoryEvidence(snapshot(), state, new Date('2026-07-24T00:00:00.000Z')),
    ).toEqual(
      expect.arrayContaining([
        'Linked release manifest versions must agree; found: 0.13.0-alpha.1, 0.14.0-alpha.1',
        'packages/registry: package version 0.12.0-alpha.1 does not match evidence source version 0.13.0-alpha.1',
      ]),
    );
  });

  it('rejects stale or ownerless manual settings evidence', () => {
    const evidence = snapshot();
    evidence.settings[0]!.owner = '';
    evidence.settings[1]!.observed_at = '2026-01-01';

    expect(
      validateRepositoryEvidence(evidence, localState(), new Date('2026-07-24T00:00:00.000Z')),
    ).toEqual(
      expect.arrayContaining([
        'Private vulnerability reporting: settings evidence must include an owner',
        'npm-publish environment: settings evidence is older than its 90-day refresh cadence',
      ]),
    );
  });

  it('rejects inconsistent open-work counts and non-advancing release PRs', () => {
    const evidence = snapshot();
    evidence.repository.open_work.total = 99;
    evidence.release.active_release_pr!.proposed_version = '0.12.0-alpha.1';

    expect(
      validateRepositoryEvidence(evidence, localState(), new Date('2026-07-24T00:00:00.000Z')),
    ).toEqual(
      expect.arrayContaining([
        'Open-work total 99 must equal issues 15 plus pull requests 1',
        'Active release PR version 0.12.0-alpha.1 must advance source version 0.13.0-alpha.1',
      ]),
    );
  });

  it('renders and replaces a generated maturity-report section deterministically', () => {
    const rendered = renderRepositoryEvidence(snapshot());
    const report = `# Maturity\n\nIntro.\n\n<!-- repository-evidence:start -->\nold\n<!-- repository-evidence:end -->\n\n## Narrative\n`;
    const updated = injectRepositoryEvidence(report, rendered);

    expect(rendered).toContain('Observed at **2026-07-23T21:05:00.000Z**');
    expect(rendered).toContain('[#202](https://github.com/oaslananka/a2amesh/pull/202)');
    expect(rendered).toContain('15 issues and 1 pull request');
    expect(updated).not.toContain('\nold\n');
    expect(injectRepositoryEvidence(updated, rendered)).toBe(updated);
  });

  it('rejects volatile legacy claims outside the generated section', () => {
    const report = `${renderRepositoryEvidence(snapshot())}\n\nRelease Please PR remains open. Inspect PR #41 separately. Private reporting needs UI confirmation.`;

    expect(validateMaturityReport(report)).toEqual(
      expect.arrayContaining([
        'Maturity report contains stale volatile wording: Release Please PR remains open',
        'Maturity report contains stale volatile wording: PR #41',
        'Maturity report contains stale volatile wording: needs UI confirmation',
      ]),
    );
  });
});
