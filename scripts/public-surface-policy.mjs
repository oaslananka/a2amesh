const SUPPORTED_STATUSES = new Set(['alpha', 'beta', 'rc', 'stable']);

function sortedStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left, right) {
  return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
}

export function releaseChannelForVersion(version) {
  const match =
    /^\d+\.\d+\.\d+(?:-([0-9A-Za-z]+)(?:[.-][0-9A-Za-z.-]+)?)?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      version,
    );
  if (!match) return undefined;
  return match[1] ?? 'stable';
}

export function validatePublicSurfacePolicy({
  packagePath,
  inventoryPath,
  packageJson,
  inventory,
  target = 'current',
}) {
  const failures = [];
  const actualExports = Object.keys(packageJson.exports ?? {});
  const expectedExports = Array.isArray(inventory.exports) ? inventory.exports : [];
  const bin = packageJson.bin;
  const actualBins =
    typeof bin === 'string'
      ? [packageJson.name?.split('/').at(-1) ?? packageJson.name]
      : Object.keys(bin ?? {});
  const expectedBins = Array.isArray(inventory.bins) ? inventory.bins : [];
  const releaseChannel = releaseChannelForVersion(packageJson.version);

  if (!SUPPORTED_STATUSES.has(inventory.status)) {
    failures.push(`${inventoryPath}: status must be one of ${[...SUPPORTED_STATUSES].join(', ')}`);
  }
  if (!sameStrings(actualExports, expectedExports)) {
    failures.push(
      `${packagePath}: exports ${JSON.stringify(sortedStrings(actualExports))} do not match ${inventoryPath} ${JSON.stringify(sortedStrings(expectedExports))}`,
    );
  }
  if (!sameStrings(actualBins, expectedBins)) {
    failures.push(
      `${packagePath}: bins ${JSON.stringify(sortedStrings(actualBins))} do not match ${inventoryPath} ${JSON.stringify(sortedStrings(expectedBins))}`,
    );
  }
  if (!releaseChannel) {
    failures.push(
      `${packagePath}: version ${JSON.stringify(packageJson.version)} is not valid SemVer`,
    );
  } else if (inventory.status !== releaseChannel) {
    failures.push(
      `${inventoryPath}: status ${JSON.stringify(inventory.status)} must match package version channel ${JSON.stringify(releaseChannel)}`,
    );
  }
  if (target === 'stable' && (inventory.status !== 'stable' || releaseChannel !== 'stable')) {
    failures.push(
      `${packagePath}: stable release target requires a stable package version and inventory status`,
    );
  }

  return failures;
}
