import type { CoveragePolicy } from './coverage-policy.mjs';

export function validateCoveragePolicy(input: {
  policy: CoveragePolicy;
  activePackages: string[];
  existingPaths: Set<string>;
  vitestConfig: string;
  packageJson: { scripts?: Record<string, string> };
  ciWorkflow: string;
}): string[];
