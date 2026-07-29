import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  buildReleaseComponentTagPlan,
  parseArgs,
  syncReleaseComponentTags,
} from '../../scripts/sync-release-component-tags.mjs';

type Request = {
  method: string;
  path: string;
  body?: unknown;
};

function fixture() {
  return {
    config: {
      packages: {
        'packages/protocol': {
          component: '@a2amesh/protocol',
        },
        'packages/runtime': {
          component: '@a2amesh/runtime',
        },
      },
    },
    manifest: {
      'packages/protocol': '0.15.0-alpha.1',
      'packages/runtime': '0.15.0-alpha.1',
    },
  };
}

describe('Release Please component tag synchronization', () => {
  it('keeps the CLI free of PATH command resolution and promise chains', async () => {
    const repoRoot = new URL('../..', import.meta.url);
    const script = await readFile(
      new URL('scripts/sync-release-component-tags.mjs', repoRoot),
      'utf8',
    );

    expect(script).not.toContain('execFileSync');
    expect(script).not.toContain('main().catch');
    expect(script).toContain('await main()');
  });

  it('requires an explicit release commit before any Git command can be resolved', () => {
    expect(() =>
      parseArgs(['--repo', 'oaslananka/a2amesh', '--version', '0.15.0-alpha.1']),
    ).toThrow('--commit is required');
  });

  it('builds one component tag per linked release package', () => {
    const { config, manifest } = fixture();

    expect(
      buildReleaseComponentTagPlan({
        config,
        manifest,
        version: '0.15.0-alpha.1',
      }),
    ).toEqual([
      {
        component: '@a2amesh/protocol',
        path: 'packages/protocol',
        tag: '@a2amesh/protocol-v0.15.0-alpha.1',
      },
      {
        component: '@a2amesh/runtime',
        path: 'packages/runtime',
        tag: '@a2amesh/runtime-v0.15.0-alpha.1',
      },
    ]);
  });

  it('verifies existing lightweight and annotated tags at the release commit', async () => {
    const requests: Request[] = [];
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      requests.push({ method, path, body });
      if (path.endsWith('%40a2amesh%2Fprotocol-v0.15.0-alpha.1')) {
        return { object: { type: 'commit', sha: 'release-commit' } };
      }
      if (path.endsWith('%40a2amesh%2Fruntime-v0.15.0-alpha.1')) {
        return { object: { type: 'tag', sha: 'runtime-tag-object' } };
      }
      if (path.endsWith('/git/tags/runtime-tag-object')) {
        return { object: { type: 'commit', sha: 'release-commit' } };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const result = await syncReleaseComponentTags({
      repository: 'oaslananka/a2amesh',
      commit: 'release-commit',
      version: '0.15.0-alpha.1',
      tags: buildReleaseComponentTagPlan({ ...fixture(), version: '0.15.0-alpha.1' }),
      github: { request },
      verifyOnly: true,
    });

    expect(result).toEqual([
      {
        tag: '@a2amesh/protocol-v0.15.0-alpha.1',
        commit: 'release-commit',
        status: 'verified',
      },
      {
        tag: '@a2amesh/runtime-v0.15.0-alpha.1',
        commit: 'release-commit',
        status: 'verified',
      },
    ]);
    expect(requests).toHaveLength(3);
  });

  it('creates a missing annotated component tag and ref', async () => {
    const requests: Request[] = [];
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      requests.push({ method, path, body });
      if (method === 'GET') {
        const error = new Error('Not Found') as Error & { status: number };
        error.status = 404;
        throw error;
      }
      if (path.endsWith('/git/tags')) return { sha: 'new-tag-object' };
      if (path.endsWith('/git/refs')) return { ref: 'refs/tags/new-tag' };
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    const [result] = await syncReleaseComponentTags({
      repository: 'oaslananka/a2amesh',
      commit: 'release-commit',
      version: '0.15.0-alpha.1',
      tags: [
        {
          component: '@a2amesh/protocol',
          path: 'packages/protocol',
          tag: '@a2amesh/protocol-v0.15.0-alpha.1',
        },
      ],
      github: { request },
    });

    expect(result).toEqual({
      tag: '@a2amesh/protocol-v0.15.0-alpha.1',
      commit: 'release-commit',
      status: 'created',
    });
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/repos/oaslananka/a2amesh/git/tags',
      body: {
        tag: '@a2amesh/protocol-v0.15.0-alpha.1',
        message: 'Release @a2amesh/protocol 0.15.0-alpha.1',
        object: 'release-commit',
        type: 'commit',
      },
    });
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/repos/oaslananka/a2amesh/git/refs',
      body: {
        ref: 'refs/tags/@a2amesh/protocol-v0.15.0-alpha.1',
        sha: 'new-tag-object',
      },
    });
  });

  it('fails closed when verify-only mode finds a missing tag', async () => {
    const request = vi.fn(async () => {
      const error = new Error('Not Found') as Error & { status: number };
      error.status = 404;
      throw error;
    });

    await expect(
      syncReleaseComponentTags({
        repository: 'oaslananka/a2amesh',
        commit: 'release-commit',
        version: '0.15.0-alpha.1',
        tags: [
          {
            component: '@a2amesh/protocol',
            path: 'packages/protocol',
            tag: '@a2amesh/protocol-v0.15.0-alpha.1',
          },
        ],
        github: { request },
        verifyOnly: true,
      }),
    ).rejects.toThrow('Missing Release Please component tag');
  });

  it('preflights every existing tag before creating any missing refs', async () => {
    const requests: Request[] = [];
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      requests.push({ method, path, body });
      if (method === 'GET' && path.endsWith('%40a2amesh%2Fprotocol-v0.15.0-alpha.1')) {
        const error = new Error('Not Found') as Error & { status: number };
        error.status = 404;
        throw error;
      }
      if (method === 'GET' && path.endsWith('%40a2amesh%2Fruntime-v0.15.0-alpha.1')) {
        return { object: { type: 'commit', sha: 'wrong-commit' } };
      }
      return { sha: 'unexpected-mutation' };
    });

    await expect(
      syncReleaseComponentTags({
        repository: 'oaslananka/a2amesh',
        commit: 'release-commit',
        version: '0.15.0-alpha.1',
        tags: buildReleaseComponentTagPlan({ ...fixture(), version: '0.15.0-alpha.1' }),
        github: { request },
      }),
    ).rejects.toThrow('points to wrong-commit instead of release-commit');

    expect(requests.filter(({ method }) => method === 'POST')).toEqual([]);
  });

  it('rejects a component tag that points at another commit', async () => {
    const request = vi.fn(async () => ({ object: { type: 'commit', sha: 'wrong-commit' } }));

    await expect(
      syncReleaseComponentTags({
        repository: 'oaslananka/a2amesh',
        commit: 'release-commit',
        version: '0.15.0-alpha.1',
        tags: [
          {
            component: '@a2amesh/protocol',
            path: 'packages/protocol',
            tag: '@a2amesh/protocol-v0.15.0-alpha.1',
          },
        ],
        github: { request },
      }),
    ).rejects.toThrow('points to wrong-commit instead of release-commit');
  });
});
