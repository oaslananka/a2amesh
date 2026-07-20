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
});
