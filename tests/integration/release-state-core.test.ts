import { describe, expect, it } from 'vitest';
import {
  compareSemanticVersions,
  evaluateReleaseState,
  expectedDistTag,
} from '../../scripts/release-state-core.mjs';

type ObservationOverrides = {
  sourceVersions?: string[];
  checkedOutCommit?: string;
  tagCommit?: string | null;
  npmPublished?: string[];
  expectedTags?: string[];
  latest?: string;
  releasePrVersions?: string[][];
  errors?: string[];
  supersession?: {
    version: string;
    releaseCommit: string;
    successorVersion: string;
    decisionDate: string;
    issue: string;
    reason: string;
  } | null;
};

const packageNames = [
  '@a2amesh/protocol',
  '@a2amesh/runtime',
  '@a2amesh/registry',
  '@a2amesh/mcp',
  '@a2amesh/cli',
  '@a2amesh/create-a2amesh',
];

function observation(overrides: ObservationOverrides = {}) {
  const sourceVersions = overrides.sourceVersions ?? packageNames.map(() => '0.11.0-alpha.1');
  const checkedOutCommit = overrides.checkedOutCommit ?? 'abc123';
  const npmPublished = new Set(overrides.npmPublished ?? packageNames);
  const expectedTags = new Set(overrides.expectedTags ?? packageNames);
  const latest = overrides.latest ?? '0.1.0-alpha.1';

  return {
    repository: 'oaslananka/a2amesh',
    checkedOutCommit,
    sourcePackages: packageNames.map((name, index) => {
      const version = sourceVersions[index];
      if (!version) throw new Error(`Missing fixture version for ${name}`);
      return {
        name,
        path: `packages/${name.slice('@a2amesh/'.length)}`,
        version,
      };
    }),
    canonicalTag: {
      name: '@a2amesh/runtime-v0.11.0-alpha.1',
      commit: overrides.tagCommit === undefined ? checkedOutCommit : overrides.tagCommit,
    },
    releasePrs: (overrides.releasePrVersions ?? []).map((versions, index) => ({
      number: 156 + index,
      url: `https://example.test/${156 + index}`,
      versions,
    })),
    npmPackages: packageNames.map((name) => ({
      name,
      versionExists: npmPublished.has(name),
      distTags: {
        latest,
        ...(expectedTags.has(name) ? { alpha: '0.11.0-alpha.1' } : {}),
      },
    })),
    errors: overrides.errors ?? [],
    supersession: overrides.supersession ?? null,
  };
}

describe('release-state core', () => {
  it('derives stable and prerelease dist-tags', () => {
    expect(expectedDistTag('1.2.3')).toBe('latest');
    expect(expectedDistTag('0.11.0-alpha.1')).toBe('alpha');
    expect(expectedDistTag('1.0.0-rc.2')).toBe('rc');
    expect(compareSemanticVersions('0.12.0-alpha.1', '0.11.0-alpha.1')).toBeGreaterThan(0);
    expect(compareSemanticVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('classifies a fully published alpha while latest remains on an older version', () => {
    const result = evaluateReleaseState(observation());

    expect(result.state).toBe('published');
    expect(result.expectedDistTag).toBe('alpha');
    expect(result.gates).toEqual({ releasePlease: true, publish: false });
    expect(result.blockers).toEqual([]);
  });

  it('classifies one newer linked release PR as release-pr-open', () => {
    const result = evaluateReleaseState(
      observation({ releasePrVersions: [packageNames.map(() => '0.12.0-alpha.1')] }),
    );

    expect(result.state).toBe('release-pr-open');
    expect(result.gates.releasePlease).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('#156'));
  });

  it('allows protected publication with a matching tag and newer release PR', () => {
    const result = evaluateReleaseState(
      observation({
        npmPublished: [],
        expectedTags: [],
        releasePrVersions: [packageNames.map(() => '0.12.0-alpha.1')],
      }),
    );

    expect(result.state).toBe('prepared-unpublished');
    expect(result.gates).toEqual({ releasePlease: false, publish: true });
  });

  it('blocks publish when the canonical tag is missing', () => {
    const result = evaluateReleaseState(
      observation({ tagCommit: null, npmPublished: [], expectedTags: [] }),
    );

    expect(result.state).toBe('prepared-unpublished');
    expect(result.gates.publish).toBe(false);
    expect(result.blockers).toContainEqual(expect.stringContaining('canonical tag'));
  });

  it('classifies a subset of package versions as partial-publication', () => {
    const result = evaluateReleaseState(
      observation({
        npmPublished: packageNames.slice(0, 2),
        expectedTags: packageNames.slice(0, 2),
      }),
    );

    expect(result.state).toBe('partial-publication');
    expect(result.gates).toEqual({ releasePlease: false, publish: true });
  });

  it('classifies all package versions with missing expected tags as partial-publication', () => {
    const result = evaluateReleaseState(observation({ expectedTags: [] }));

    expect(result.state).toBe('partial-publication');
    expect(result.blockers).toContainEqual(expect.stringContaining('alpha'));
  });

  it('rejects latest when it points to the prepared prerelease', () => {
    const result = evaluateReleaseState(observation({ latest: '0.11.0-alpha.1' }));

    expect(result.state).toBe('drifted');
    expect(result.gates).toEqual({ releasePlease: false, publish: false });
    expect(result.blockers).toContainEqual(expect.stringContaining('latest'));
  });

  it('rejects a canonical tag that resolves to another commit', () => {
    const result = evaluateReleaseState(observation({ tagCommit: 'def456' }));

    expect(result.state).toBe('drifted');
    expect(result.blockers).toContainEqual(expect.stringContaining('def456'));
  });

  it('rejects internally inconsistent source versions', () => {
    const result = evaluateReleaseState(
      observation({
        sourceVersions: ['0.11.0-alpha.1', ...packageNames.slice(1).map(() => '0.10.0-alpha.1')],
      }),
    );

    expect(result.state).toBe('drifted');
    expect(result.version).toBeNull();
  });

  it('rejects multiple release pull requests', () => {
    const result = evaluateReleaseState(
      observation({
        releasePrVersions: [
          packageNames.map(() => '0.12.0-alpha.1'),
          packageNames.map(() => '0.13.0-alpha.1'),
        ],
      }),
    );

    expect(result.state).toBe('drifted');
    expect(result.blockers).toContainEqual(expect.stringContaining('Multiple Release Please'));
  });

  it('rejects a release pull request that regresses the prepared version', () => {
    const result = evaluateReleaseState(
      observation({ releasePrVersions: [packageNames.map(() => '0.10.0-alpha.1')] }),
    );

    expect(result.state).toBe('drifted');
    expect(result.blockers).toContainEqual(expect.stringContaining('must advance'));
  });

  it('rejects a release pull request with inconsistent linked versions', () => {
    const result = evaluateReleaseState(
      observation({
        releasePrVersions: [
          [
            '0.12.0-alpha.1',
            '0.12.0-alpha.1',
            '0.13.0-alpha.1',
            '0.12.0-alpha.1',
            '0.12.0-alpha.1',
            '0.12.0-alpha.1',
          ],
        ],
      }),
    );

    expect(result.state).toBe('drifted');
    expect(result.blockers).toContainEqual(expect.stringContaining('linked version'));
  });

  it('classifies deterministic source drift separately from observation failures', () => {
    const result = evaluateReleaseState({
      ...observation(),
      drift: ['packages/runtime: package version does not match release manifest'],
    });

    expect(result.state).toBe('drifted');
    expect(result.blockers).toContainEqual(expect.stringContaining('package version'));
  });

  it('allows Release Please to advance an explicitly superseded unpublished version', () => {
    const result = evaluateReleaseState(
      observation({
        tagCommit: null,
        npmPublished: [],
        expectedTags: [],
        supersession: {
          version: '0.11.0-alpha.1',
          releaseCommit: 'release123',
          successorVersion: '0.12.0-alpha.1',
          decisionDate: '2026-07-22',
          issue: 'https://github.com/oaslananka/a2amesh/issues/184',
          reason: 'Historical candidate superseded after release-integrity review.',
        },
      }),
    );

    expect(result.state).toBe('superseded');
    expect(result.gates).toEqual({ releasePlease: true, publish: false });
    expect(result.blockers).toEqual([]);
    expect(result.nextSafeAction).toContain('0.12.0-alpha.1');
  });

  it('rejects supersession after the canonical tag exists', () => {
    const result = evaluateReleaseState(
      observation({
        npmPublished: [],
        expectedTags: [],
        supersession: {
          version: '0.11.0-alpha.1',
          releaseCommit: 'release123',
          successorVersion: '0.12.0-alpha.1',
          decisionDate: '2026-07-22',
          issue: 'https://github.com/oaslananka/a2amesh/issues/184',
          reason: 'Historical candidate superseded after release-integrity review.',
        },
      }),
    );

    expect(result.state).toBe('drifted');
    expect(result.gates).toEqual({ releasePlease: false, publish: false });
    expect(result.blockers).toContainEqual(
      expect.stringContaining('must not have a canonical tag'),
    );
  });

  it('rejects supersession after any linked package was published', () => {
    const result = evaluateReleaseState(
      observation({
        tagCommit: null,
        npmPublished: [packageNames[0]!],
        expectedTags: [packageNames[0]!],
        supersession: {
          version: '0.11.0-alpha.1',
          releaseCommit: 'release123',
          successorVersion: '0.12.0-alpha.1',
          decisionDate: '2026-07-22',
          issue: 'https://github.com/oaslananka/a2amesh/issues/184',
          reason: 'Historical candidate superseded after release-integrity review.',
        },
      }),
    );

    expect(result.state).toBe('drifted');
    expect(result.gates).toEqual({ releasePlease: false, publish: false });
    expect(result.blockers).toContainEqual(
      expect.stringContaining('must not have npm publication'),
    );
  });

  it('classifies observation failures as unavailable', () => {
    const result = evaluateReleaseState(observation({ errors: ['npm registry timed out'] }));

    expect(result.state).toBe('unavailable');
    expect(result.gates).toEqual({ releasePlease: false, publish: false });
    expect(result.blockers).toContain('npm registry timed out');
  });
});
