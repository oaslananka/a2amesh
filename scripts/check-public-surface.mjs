import { readJson, fail } from './check-utils.mjs';
import { validatePublicSurfacePolicy } from './public-surface-policy.mjs';

const publicPackages = ['protocol', 'runtime', 'registry', 'mcp', 'cli', 'create-a2amesh'];
const target =
  process.argv.includes('--target=stable') || process.argv.includes('--stable')
    ? 'stable'
    : 'current';
const failures = [];

for (const packageDirectory of publicPackages) {
  const packagePath = `packages/${packageDirectory}/package.json`;
  const inventoryPath = `packages/${packageDirectory}/public-surface.json`;
  failures.push(
    ...validatePublicSurfacePolicy({
      packagePath,
      inventoryPath,
      packageJson: readJson(packagePath),
      inventory: readJson(inventoryPath),
      target,
    }),
  );
}

if (failures.length > 0) {
  fail('Public surface validation failed.', failures);
} else {
  console.log(`Public surface validation passed for ${target} target.`);
}
