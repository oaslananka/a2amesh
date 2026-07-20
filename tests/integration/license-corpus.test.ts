import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const CANONICAL_APACHE_2_SHA256 =
  'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('license corpus', () => {
  it('keeps both Apache-2.0 copies byte-exact to the canonical text', async () => {
    const [rootLicense, reuseLicense] = await Promise.all([
      readFile(new URL('../../LICENSE', import.meta.url)),
      readFile(new URL('../../LICENSES/Apache-2.0.txt', import.meta.url)),
    ]);

    expect(sha256(rootLicense)).toBe(CANONICAL_APACHE_2_SHA256);
    expect(sha256(reuseLicense)).toBe(CANONICAL_APACHE_2_SHA256);
    expect(rootLicense).toEqual(reuseLicense);
  });

  it('keeps every publishable package on Apache-2.0 metadata', async () => {
    const releaseConfig = JSON.parse(
      await readFile(new URL('../../release-please-config.json', import.meta.url), 'utf8'),
    ) as { packages?: Record<string, unknown> };
    const packagePaths = Object.keys(releaseConfig.packages ?? {});

    expect(packagePaths.length).toBeGreaterThan(0);
    for (const packagePath of packagePaths) {
      const packageJson = JSON.parse(
        await readFile(new URL(`../../${packagePath}/package.json`, import.meta.url), 'utf8'),
      ) as { license?: string; private?: boolean };
      expect(packageJson.private).not.toBe(true);
      expect(packageJson.license).toBe('Apache-2.0');
    }
  });
});
