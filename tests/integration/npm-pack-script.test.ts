import { readFile, readdir, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageEntryFixture {
  packageJson: {
    name: string;
    exports?: Record<string, unknown> | string;
    bin?: Record<string, string> | string;
  };
}

interface PackedPackageFixture extends PackageEntryFixture {
  relativeTarball: string;
}

interface CheckNpmPackModule {
  createConsumerPackageJson(
    packages: PackedPackageFixture[],
    options: { packageManager: string; typescriptVersion: string },
  ): {
    private: true;
    type: 'module';
    packageManager: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  createConsumerWorkspaceYaml(packages: PackedPackageFixture[]): string;
  createImportSmokeSource(packages: PackageEntryFixture[]): string;
  createTypecheckSmokeSource(packages: PackageEntryFixture[]): string;
  getBinarySmokeCommand(packageJson: PackageEntryFixture['packageJson'], binName: string): string[];
}

async function loadCheckNpmPackModule(): Promise<CheckNpmPackModule> {
  return (await import(
    new URL('../../scripts/check-npm-pack.mjs', import.meta.url).href
  )) as unknown as CheckNpmPackModule;
}

describe('check-npm-pack consumer smoke helpers', () => {
  it('keeps declared workspace binary targets available before build', async () => {
    const repoRoot = new URL('../..', import.meta.url);
    const packageDirs = ['docs-site'];
    for (const workspaceRoot of ['apps', 'examples', 'packages']) {
      const entries = await readdir(new URL(`${workspaceRoot}/`, repoRoot), {
        withFileTypes: true,
      });
      packageDirs.push(
        ...entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${workspaceRoot}/${entry.name}`),
      );
    }

    for (const packageDir of packageDirs) {
      const packageJson = JSON.parse(
        await readFile(new URL(`${packageDir}/package.json`, repoRoot), 'utf8'),
      ) as { name: string; bin?: Record<string, string> | string };
      const targets =
        typeof packageJson.bin === 'string'
          ? [packageJson.bin]
          : Object.values(packageJson.bin ?? {});

      for (const target of targets) {
        const exists = await stat(new URL(`${packageDir}/${target}`, repoRoot))
          .then((entry) => entry.isFile())
          .catch(() => false);
        expect(exists, `${packageJson.name} binary target ${target} must exist before build`).toBe(
          true,
        );
      }
    }
  });

  it('generates runtime and typecheck imports for every declared export path', async () => {
    const { createImportSmokeSource, createTypecheckSmokeSource } = await loadCheckNpmPackModule();
    const packages = [
      {
        packageJson: {
          name: '@scope/runtime',
          exports: {
            '.': {
              types: './dist/index.d.ts',
              import: './dist/index.js',
            },
            './auth': {
              types: './dist/auth/index.d.ts',
              import: './dist/auth/index.js',
            },
            './internal/*': './dist/internal/*.js',
          },
        },
      },
      {
        packageJson: {
          name: 'create-example',
          exports: './dist/index.js',
        },
      },
    ];

    const runtimeSource = createImportSmokeSource(packages);
    const typecheckSource = createTypecheckSmokeSource(packages);

    for (const source of [runtimeSource, typecheckSource]) {
      expect(source).toContain("from '@scope/runtime';");
      expect(source).toContain("from '@scope/runtime/auth';");
      expect(source).toContain("from 'create-example';");
      expect(source).not.toContain('internal/*');
    }
  });

  it('creates a consumer manifest that installs every packed tarball', async () => {
    const { createConsumerPackageJson, createConsumerWorkspaceYaml } =
      await loadCheckNpmPackModule();
    const packages = [
      {
        packageJson: { name: '@scope/runtime' },
        relativeTarball: '../tarballs/scope-runtime-1.0.0.tgz',
      },
      {
        packageJson: { name: 'create-example' },
        relativeTarball: '../tarballs/create-example-1.0.0.tgz',
      },
    ];
    const manifest = createConsumerPackageJson(packages, {
      packageManager: 'pnpm@11.2.2',
      typescriptVersion: '^6.0.3',
    });

    expect(manifest).toMatchObject({
      private: true,
      type: 'module',
      packageManager: 'pnpm@11.2.2',
      dependencies: {
        '@scope/runtime': 'file:../tarballs/scope-runtime-1.0.0.tgz',
        'create-example': 'file:../tarballs/create-example-1.0.0.tgz',
      },
      devDependencies: {
        typescript: '^6.0.3',
      },
    });
    expect(createConsumerWorkspaceYaml(packages)).toBe(
      [
        'packages: []',
        'overrides:',
        '  "@scope/runtime": "file:../tarballs/scope-runtime-1.0.0.tgz"',
        '  "create-example": "file:../tarballs/create-example-1.0.0.tgz"',
        '',
      ].join('\n'),
    );
  });

  it('uses non-network smoke commands for published binaries', async () => {
    const { getBinarySmokeCommand } = await loadCheckNpmPackModule();

    expect(
      getBinarySmokeCommand(
        {
          name: '@a2amesh/cli',
          bin: { a2amesh: 'bin/a2amesh.js' },
        },
        'a2amesh',
      ),
    ).toEqual(['doctor', '--json']);
    expect(
      getBinarySmokeCommand(
        {
          name: '@a2amesh/registry',
          bin: { 'a2amesh-registry': 'bin/a2amesh-registry.js' },
        },
        'a2amesh-registry',
      ),
    ).toEqual(['--help']);
    expect(
      getBinarySmokeCommand(
        {
          name: '@a2amesh/create-a2amesh',
          bin: { 'create-a2amesh': 'bin/create-a2amesh.js' },
        },
        'create-a2amesh',
      ),
    ).toEqual(['--help']);
  });
});
