import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface ReleasePrPolicySyncModule {
  syncReleasePrPolicy(
    repoRoot: string,
    options?: {
      clearReleaseAs?: boolean;
      syncInstallDocs?: boolean;
      installDocumentPaths?: string[];
      releasePullRequest?: { number: number; title: string; url: string };
    },
  ): Promise<{
    updatedSurfaces: string[];
    updatedInstallDocs: string[];
    updatedEvidence: boolean;
    clearedReleaseAs: boolean;
  }>;
}

async function loadSyncModule(): Promise<ReleasePrPolicySyncModule> {
  return (await import(
    new URL('../../scripts/sync-release-pr-policy.mjs', import.meta.url).href
  )) as unknown as ReleasePrPolicySyncModule;
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe('release pull request policy synchronization', () => {
  it('aligns tracked public-surface statuses with release versions and clears one-shot release-as', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'a2amesh-release-pr-policy-'));

    try {
      await writeJson(path.join(root, 'release-please-config.json'), {
        'release-type': 'node',
        'release-as': '0.18.1',
        packages: {
          'packages/runtime': { 'package-name': '@a2amesh/runtime' },
          'packages/cli': { 'package-name': '@a2amesh/cli' },
        },
      });
      await writeJson(path.join(root, 'packages/runtime/package.json'), {
        name: '@a2amesh/runtime',
        version: '0.18.1',
      });
      await writeJson(path.join(root, 'packages/runtime/public-surface.json'), {
        status: 'alpha',
        exports: ['.'],
        bins: [],
      });
      await writeJson(path.join(root, 'packages/cli/package.json'), {
        name: '@a2amesh/cli',
        version: '0.18.1-beta.2',
      });
      await writeJson(path.join(root, 'packages/cli/public-surface.json'), {
        status: 'alpha',
        exports: ['.'],
        bins: ['a2amesh'],
      });
      await writeJson(path.join(root, 'packages/internal/package.json'), {
        name: '@a2amesh/internal-example',
        version: '0.1.0-alpha.0',
      });
      await writeJson(path.join(root, 'packages/internal/public-surface.json'), {
        status: 'alpha',
        exports: ['.'],
        bins: [],
      });

      const { syncReleasePrPolicy } = await loadSyncModule();
      const result = await syncReleasePrPolicy(root, { clearReleaseAs: true });

      expect(result).toEqual({
        updatedSurfaces: [
          'packages/cli/public-surface.json',
          'packages/runtime/public-surface.json',
        ],
        updatedInstallDocs: [],
        updatedEvidence: false,
        clearedReleaseAs: true,
      });
      expect(
        JSON.parse(await readFile(path.join(root, 'packages/runtime/public-surface.json'), 'utf8')),
      ).toMatchObject({ status: 'stable' });
      expect(
        JSON.parse(await readFile(path.join(root, 'packages/cli/public-surface.json'), 'utf8')),
      ).toMatchObject({ status: 'beta' });
      expect(
        JSON.parse(
          await readFile(path.join(root, 'packages/internal/public-surface.json'), 'utf8'),
        ),
      ).toMatchObject({ status: 'alpha' });

      const config = JSON.parse(
        await readFile(path.join(root, 'release-please-config.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(config['release-as']).toBeUndefined();
      expect(config['release-type']).toBe('node');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rewrites configured public install documents when release versions change channel', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'a2amesh-release-pr-docs-'));

    try {
      await writeJson(path.join(root, 'release-please-config.json'), {
        packages: { 'packages/runtime': { 'package-name': '@a2amesh/runtime' } },
      });
      await writeJson(path.join(root, 'packages/runtime/package.json'), {
        name: '@a2amesh/runtime',
        version: '0.18.1',
      });
      await writeJson(path.join(root, 'packages/runtime/public-surface.json'), {
        status: 'alpha',
        exports: ['.'],
        bins: [],
      });
      await writeFile(path.join(root, 'README.md'), 'pnpm add @a2amesh/runtime@alpha\n');

      const { syncReleasePrPolicy } = await loadSyncModule();
      const result = await syncReleasePrPolicy(root, {
        syncInstallDocs: true,
        installDocumentPaths: ['README.md'],
      });

      expect(result.updatedInstallDocs).toEqual(['README.md']);
      await expect(readFile(path.join(root, 'README.md'), 'utf8')).resolves.toBe(
        'pnpm add @a2amesh/runtime\n',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('stages the active Release Please candidate in repository evidence without rewriting published release facts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'a2amesh-release-pr-evidence-'));

    try {
      await writeJson(path.join(root, 'release-please-config.json'), {
        packages: { 'packages/runtime': { 'package-name': '@a2amesh/runtime' } },
      });
      await writeJson(path.join(root, 'packages/runtime/package.json'), {
        name: '@a2amesh/runtime',
        version: '0.18.1',
      });
      await writeJson(path.join(root, 'packages/runtime/public-surface.json'), {
        status: 'stable',
        exports: ['.'],
        bins: [],
      });
      await writeJson(path.join(root, 'docs/governance/repository-evidence.json'), {
        schema_version: 1,
        observed_at: '2026-08-02T12:03:43.439Z',
        refresh_cadence_days: 14,
        repository: {
          name: 'oaslananka/a2amesh',
          url: 'https://github.com/oaslananka/a2amesh',
          default_branch: 'main',
          visibility: 'public',
          archived: false,
          license: 'Apache-2.0',
          open_work: { issues: 0, pull_requests: 0, total: 0 },
        },
        release: {
          source_version: '0.18.0-alpha.1',
          package_paths: ['packages/runtime'],
          latest_github_release: null,
          latest_canonical_tag: {
            name: '@a2amesh/runtime-v0.18.0-alpha.1',
            commit: '21a30c6757ce2a0d9712f3aeb92147a0db7fa36f',
          },
          npm: {
            package: '@a2amesh/runtime',
            alpha: '0.18.0-alpha.1',
            latest: '0.1.0-alpha.1',
          },
          active_release_pr: null,
        },
        settings: [
          {
            name: 'Private vulnerability reporting',
            value: 'enabled',
            owner: '@oaslananka',
            observed_at: '2026-08-02',
            refresh_cadence_days: 90,
            source: 'GitHub REST API: private-vulnerability-reporting',
          },
        ],
        provenance: {
          repository: 'GitHub REST API: GET /repos/oaslananka/a2amesh',
          issues: 'GitHub CLI: issue list',
          pull_requests: 'GitHub CLI: pr list',
          releases: 'GitHub REST API: releases and tags',
          npm: 'npm registry metadata',
          source_versions: '.release-please-manifest.json and package.json files',
        },
      });
      await mkdir(path.join(root, 'docs'), { recursive: true });
      await writeFile(
        path.join(root, 'docs/repo-maturity-report.md'),
        '# Maturity\n\n<!-- repository-evidence:start -->\nold\n<!-- repository-evidence:end -->\n',
      );

      const { syncReleasePrPolicy } = await loadSyncModule();
      const result = await syncReleasePrPolicy(root, {
        releasePullRequest: {
          number: 297,
          title: 'chore: release main',
          url: 'https://github.com/oaslananka/a2amesh/pull/297',
        },
      });

      expect(result.updatedEvidence).toBe(true);
      const evidence = JSON.parse(
        await readFile(path.join(root, 'docs/governance/repository-evidence.json'), 'utf8'),
      ) as {
        observed_at: string;
        release: {
          source_version: string;
          latest_canonical_tag: { name: string };
          npm: { alpha: string };
          active_release_pr: { number: number; proposed_version: string };
        };
      };
      expect(evidence.observed_at).toBe('2026-08-02T12:03:43.439Z');
      expect(evidence.release.source_version).toBe('0.18.0-alpha.1');
      expect(evidence.release.latest_canonical_tag.name).toBe('@a2amesh/runtime-v0.18.0-alpha.1');
      expect(evidence.release.npm.alpha).toBe('0.18.0-alpha.1');
      expect(evidence.release.active_release_pr).toMatchObject({
        number: 297,
        proposed_version: '0.18.1',
      });
      const report = await readFile(path.join(root, 'docs/repo-maturity-report.md'), 'utf8');
      expect(report).toContain('[#297](https://github.com/oaslananka/a2amesh/pull/297)');
      expect(report).toContain('proposes `0.18.1`');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
