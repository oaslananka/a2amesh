import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('npm dist-tag synchronization policy', () => {
  it('uses the shared dist-tag policy and never seeds prereleases with latest', async () => {
    const script = await readFile(
      new URL('../../scripts/sync-npm-tags.mjs', import.meta.url),
      'utf8',
    );

    expect(script).toContain("from './release-state-core.mjs'");
    expect(script).toContain('expectedDistTag(version)');
    expect(script).not.toContain("new Set(['latest'])");
    expect(script).toContain("expectedTag !== 'latest' && tags.latest === version");
  });

  it('documents prerelease isolation, stable promotion, and dist-tag recovery consistently', async () => {
    const [
      processDoc,
      siteProcessDoc,
      verificationDoc,
      siteVerificationDoc,
      stableDoc,
      siteStableDoc,
    ] = await Promise.all([
      readFile(new URL('../../docs/release/process.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs-site/release/process.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/release/package-verification.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs-site/release/package-verification.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/release/stable-release-criteria.md', import.meta.url), 'utf8'),
      readFile(
        new URL('../../docs-site/release/stable-release-criteria.md', import.meta.url),
        'utf8',
      ),
    ]);

    for (const document of [processDoc, siteProcessDoc]) {
      expect(document).toContain('PUBLISH STABLE <tag>');
      expect(document).toContain('Prerelease publication never advances `latest`');
      expect(document).toContain('npm dist-tag add "$package@$previous_latest" latest');
    }
    for (const document of [verificationDoc, siteVerificationDoc]) {
      expect(document).toContain('`latest` is not advanced by prerelease publication');
      expect(document).not.toContain('The `latest` tag may also point at the first alpha package');
      expect(document).toContain('dist.attestations');
      expect(document).toContain('npm audit signatures --include-attestations');
      expect(document).not.toContain('npm view "$PACKAGE@$VERSION" provenance --json');
    }
    for (const document of [stableDoc, siteStableDoc]) {
      expect(document).toContain('PUBLISH STABLE <tag>');
    }
  });
});
