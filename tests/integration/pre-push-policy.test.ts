import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts: Record<string, string>;
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;
const scripts = packageJson.scripts;

describe('pre-push policy', () => {
  it('keeps full build and full unit coverage in CI instead of the Git hook', () => {
    expect(scripts['check:pre-push']).toBe('pnpm run verify:changed');
    expect(scripts['verify:changed']).toBe(
      'git diff --check origin/main...HEAD && pnpm run lint && pnpm run typecheck:no-build && pnpm run test:unit:changed',
    );
    expect(scripts['verify:changed']).not.toContain('pnpm run typecheck &&');
    expect(scripts['verify:changed']).not.toMatch(/pnpm run test:unit(?:\s|$)/);
  });

  it('provides a build-free typecheck command while preserving the full typecheck command', () => {
    expect(scripts['typecheck']).toBe('pnpm run build && pnpm run typecheck:no-build');
    expect(scripts['typecheck:no-build']).not.toContain('pnpm run build');
    expect(scripts['typecheck:no-build']).toContain('pnpm -r --if-present run typecheck');
    expect(scripts['typecheck:no-build']).toContain('tsconfig.test.json --noEmit');
  });

  it('runs only unit tests affected relative to the remote main branch', () => {
    expect(scripts['test:unit:changed']).toBe(
      'vitest run --project unit --changed origin/main --passWithNoTests',
    );
  });
});
