import { describe, expect, it } from 'vitest';
import {
  extractLinkedVersion,
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
