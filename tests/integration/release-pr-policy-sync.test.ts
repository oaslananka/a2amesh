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
    },
  ): Promise<{
    updatedSurfaces: string[];
    updatedInstallDocs: string[];
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
});
