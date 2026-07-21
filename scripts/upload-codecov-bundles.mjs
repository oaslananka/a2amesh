import { access } from 'node:fs/promises';
import { createAndUploadReport } from '@codecov/bundle-analyzer';

const dryRun = process.argv.includes('--dry-run');
const enabled = process.env.CODECOV_BUNDLE_ANALYSIS === 'true';
const useGitHubOIDC = process.env.GITHUB_ACTIONS === 'true';
const uploadOverrides = dryRun
  ? undefined
  : {
      branch: process.env.CODECOV_BUNDLE_BRANCH,
      build: process.env.GITHUB_RUN_ID,
      pr: process.env.CODECOV_BUNDLE_PR || undefined,
      sha: process.env.CODECOV_BUNDLE_SHA,
      slug: process.env.CODECOV_BUNDLE_SLUG,
    };
const bundles = [
  { bundleName: 'registry-ui', directory: 'apps/registry-ui/dist' },
  { bundleName: 'mission-control', directory: 'apps/mission-control/dist' },
];

if (!dryRun && !enabled) {
  console.log('Codecov bundle analysis is disabled outside the explicit CI upload step.');
  process.exit(0);
}
if (!dryRun && !useGitHubOIDC) {
  throw new Error('Real Codecov bundle uploads require GitHub Actions OIDC.');
}
if (!dryRun && (!uploadOverrides?.branch || !uploadOverrides.sha || !uploadOverrides.slug)) {
  throw new Error('Codecov bundle upload metadata requires branch, SHA, and repository slug.');
}

for (const { bundleName, directory } of bundles) {
  await access(directory);
  const result = await createAndUploadReport(
    [directory],
    {
      bundleName,
      dryRun,
      retryCount: 6,
      enableBundleAnalysis: true,
      oidc: { useGitHubOIDC },
      uploadOverrides,
      gitService: 'github',
      telemetry: false,
    },
    {
      ignorePatterns: ['**/*.map'],
    },
  );
  console.log(`${bundleName}: ${result}`);
}
