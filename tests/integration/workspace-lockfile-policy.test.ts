import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../../scripts/check-workspace-declarations.mjs', import.meta.url),
);
const tempRoots: string[] = [];

describe('workspace lockfile policy', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('rejects the PR #288-style filtered update that rewrites a canonical link to file injection', async () => {
    const workspace = await createWorkspace({
      runtimeResolution:
        'file:packages/runtime(@opentelemetry/api@1.9.1)(@opentelemetry/sdk-node@0.219.0)',
    });

    await expect(execWorkspaceCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining('unexpected injected workspace resolution'),
    });
  });

  it('rejects an exact direct dependency when its canonical workspace override stays stale', async () => {
    const workspace = await createWorkspace({ overrideUndici: '7.28.0' });

    await expect(execWorkspaceCheck(workspace)).rejects.toMatchObject({
      stderr: expect.stringContaining('packages/runtime/package.json: undici 7.29.0'),
    });
  });

  it('accepts canonical workspace links and exact override parity', async () => {
    const workspace = await createWorkspace();

    await expect(execWorkspaceCheck(workspace)).resolves.toBeDefined();
  });
});

async function execWorkspaceCheck(workspace: string) {
  return execFileAsync(process.execPath, [scriptPath], { cwd: workspace });
}

async function createWorkspace({
  runtimeResolution = 'link:../runtime',
  overrideUndici = '7.29.0',
}: {
  runtimeResolution?: string;
  overrideUndici?: string;
} = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'a2amesh-workspace-lockfile-'));
  tempRoots.push(workspace);

  await writeFixture(
    workspace,
    'pnpm-workspace.yaml',
    `packages:\n  - packages/*\n  - examples/*\n\ninjectWorkspacePackages: true\nsyncInjectedDepsAfterScripts:\n  - build\noverrides:\n  undici: ${overrideUndici}\n`,
  );
  await writeFixture(
    workspace,
    'package.json',
    `${JSON.stringify({ name: 'fixture', private: true }, null, 2)}\n`,
  );
  await writeFixture(
    workspace,
    'packages/runtime/package.json',
    `${JSON.stringify(
      {
        name: '@a2amesh/runtime',
        version: '0.18.0-alpha.1',
        dependencies: { undici: '7.29.0' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    workspace,
    'packages/consumer/package.json',
    `${JSON.stringify(
      {
        name: '@a2amesh/consumer',
        version: '0.1.0',
        dependencies: { '@a2amesh/runtime': 'workspace:^' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    workspace,
    'examples/example/package.json',
    `${JSON.stringify(
      {
        name: '@a2amesh/example',
        private: true,
        dependencies: { '@a2amesh/runtime': 'workspace:*' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFixture(
    workspace,
    'pnpm-lock.yaml',
    `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: false\n  injectWorkspacePackages: true\n\noverrides:\n  undici: ${overrideUndici}\n\nimporters:\n\n  .: {}\n\n  examples/example:\n    dependencies:\n      '@a2amesh/runtime':\n        specifier: workspace:*\n        version: link:../../packages/runtime\n\n  packages/consumer:\n    dependencies:\n      '@a2amesh/runtime':\n        specifier: workspace:^\n        version: ${runtimeResolution}\n\n  packages/runtime:\n    dependencies:\n      undici:\n        specifier: 7.29.0\n        version: 7.29.0\n`,
  );

  return workspace;
}

async function writeFixture(root: string, path: string, contents: string) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}
