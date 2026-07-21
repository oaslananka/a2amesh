import { access } from 'node:fs/promises';
import { createAndUploadReport } from '@codecov/bundle-analyzer';

const dryRun = process.argv.includes('--dry-run');
const enabled = process.env.CODECOV_BUNDLE_ANALYSIS === 'true';
const uploadToken = process.env.CODECOV_TOKEN;
const bundles = [
  { bundleName: 'registry-ui', directory: 'apps/registry-ui/dist' },
  { bundleName: 'mission-control', directory: 'apps/mission-control/dist' },
];

if (!dryRun && !enabled) {
  console.log('Codecov bundle analysis is disabled outside the explicit CI upload step.');
  process.exit(0);
}
if (!dryRun && !uploadToken) {
  throw new Error('CODECOV_TOKEN is required for a real bundle analysis upload.');
}

for (const { bundleName, directory } of bundles) {
  await access(directory);
  const result = await createAndUploadReport(
    [directory],
    {
      bundleName,
      dryRun,
      retryCount: 3,
      enableBundleAnalysis: true,
      uploadToken,
      gitService: 'github',
      telemetry: false,
    },
    {
      ignorePatterns: ['**/*.map'],
    },
  );
  console.log(`${bundleName}: ${result}`);
}
