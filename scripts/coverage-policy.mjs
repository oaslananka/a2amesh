import { readFileSync } from 'node:fs';

export const coveragePolicy = JSON.parse(
  readFileSync(new URL('../coverage-policy.json', import.meta.url), 'utf8'),
);

export const coverageIncludePatterns = Object.values(coveragePolicy.packages).map(
  ({ root }) => `${root}/**/*.{ts,tsx}`,
);

export const coverageExcludePatterns = coveragePolicy.exclusions.map(({ pattern }) => pattern);

export const coverageGlobalThresholds = { ...coveragePolicy.aggregate };
