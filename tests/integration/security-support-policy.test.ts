import { describe, expect, it } from 'vitest';
import {
  extractLinkedVersion,
  publishedSupportVersion,
  renderSupportBlock,
  syncPolicyText,
  validatePolicyFiles,
} from '../../scripts/sync-security-policy.mjs';

const policyTemplate = `# Security Policy

## Supported Versions

<!-- security-support:start -->
stale
<!-- security-support:end -->

## Reporting a Vulnerability
`;

describe('security support policy', () => {
  it('derives one linked release version from the release manifest', () => {
    expect(
      extractLinkedVersion({
        'packages/runtime': '0.12.0-alpha.1',
        'packages/protocol': '0.12.0-alpha.1',
      }),
    ).toBe('0.12.0-alpha.1');

    expect(() =>
      extractLinkedVersion({
        'packages/runtime': '0.12.0-alpha.1',
        'packages/protocol': '0.13.0-alpha.1',
      }),
    ).toThrow('one linked version');
  });

  it('supports the installed npm version while a newer source release awaits publication', () => {
    const manifest = { 'packages/runtime': '0.19.0', 'packages/protocol': '0.19.0' };
    const evidence = {
      release: {
        npm: { package: '@a2amesh/runtime', latest: '0.18.2' },
        latest_canonical_tag: { name: '@a2amesh/runtime-v0.18.2' },
      },
    };
    expect(publishedSupportVersion(manifest, evidence)).toBe('0.18.2');
    expect(renderSupportBlock(publishedSupportVersion(manifest, evidence))).toContain('0.18.2');
    expect(() =>
      publishedSupportVersion(manifest, {
        release: {
          ...evidence.release,
          latest_canonical_tag: { name: '@a2amesh/runtime-v0.19.0' },
        },
      }),
    ).toThrow('matching npm tag');
  });

  it('renders the latest-alpha-only support window', () => {
    const block = renderSupportBlock('0.12.0-alpha.1');

    expect(block).toContain('`0.12.0-alpha.1` (`alpha` dist-tag)');
    expect(block).toContain('Supported');
    expect(block).toContain('Earlier prereleases');
    expect(block).toContain('Unsupported');
    expect(block).toContain('Unreleased `main` revisions');
    expect(block).toContain('Security fixes ship in a new linked release');
  });

  it('synchronizes the generated support fragment without changing the remaining policy', () => {
    const result = syncPolicyText(policyTemplate, '0.12.0-alpha.1');

    expect(result).toContain(renderSupportBlock('0.12.0-alpha.1'));
    expect(result).toContain('## Reporting a Vulnerability');
    expect(result).not.toContain('stale');
  });

  it('rejects prerelease-only support prose for a stable linked release', () => {
    const staleStablePolicy = `${syncPolicyText(policyTemplate, '0.18.1')}\nA2A Mesh is currently a pre-1.0 alpha project. Support applies only to the newest fully published,\nlinked prerelease exposed through the npm \`alpha\` dist-tag.\n`;

    expect(
      validatePolicyFiles({
        version: '0.18.1',
        rootPolicy: staleStablePolicy,
        githubPolicy: staleStablePolicy,
      }),
    ).toEqual([
      'SECURITY.md contains prerelease-only support guidance for stable linked release 0.18.1.',
    ]);
  });

  it('flags version drift and duplicate policy copies', () => {
    const current = syncPolicyText(policyTemplate, '0.12.0-alpha.1');
    const stale = syncPolicyText(policyTemplate, '0.11.0-alpha.1');

    expect(
      validatePolicyFiles({
        version: '0.12.0-alpha.1',
        rootPolicy: current,
        githubPolicy: current,
      }),
    ).toEqual([]);

    expect(
      validatePolicyFiles({
        version: '0.12.0-alpha.1',
        rootPolicy: stale,
        githubPolicy: current,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('SECURITY.md support fragment is out of date'),
        expect.stringContaining('policy copies must match'),
      ]),
    );
  });
});
