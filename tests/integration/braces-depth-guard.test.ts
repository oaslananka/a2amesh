import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Braces = (pattern: string, options: { expand: boolean }) => string[];

describe('patched braces dependency', () => {
  it('preserves normal expansion and blocks deeply nested input', () => {
    const virtualStore = resolve(process.cwd(), 'node_modules/.pnpm');
    const patched = readdirSync(virtualStore).filter((entry) =>
      entry.startsWith('braces@3.0.3_patch_hash='),
    );

    expect(patched, 'pnpm must install the security-patched braces dependency').toHaveLength(1);

    const [patchedDirectory] = patched;
    if (!patchedDirectory) {
      throw new Error('Patched braces installation is missing');
    }
    const require = createRequire(import.meta.url);
    const braces = require(
      resolve(virtualStore, patchedDirectory, 'node_modules/braces'),
    ) as Braces;

    expect(braces('{alpha,beta}', { expand: true })).toEqual(['alpha', 'beta']);
    expect(() => braces('{'.repeat(230) + 'x' + '}'.repeat(230), { expand: true })).toThrow(
      /nesting depth/,
    );
  });
});
