import { readFileSync } from 'node:fs';

const REGISTRY = 'https://registry.npmjs.org';

const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));

const publishable = Object.entries(config.packages ?? {})
  .map(([path, entry]) => ({
    path,
    packageName: entry['package-name'],
    component: entry.component,
    manifestVersion: manifest[path],
    packageJson: JSON.parse(readFileSync(`${path}/package.json`, 'utf8')),
  }))
  .filter(
    (p) =>
      !p.packageJson.private && p.packageJson.name && !p.packageJson.name.startsWith('a2amesh-'),
  );

const failures = [];
const missing = [];

function expectedDistTag(version) {
  const prerelease = /-([0-9A-Za-z-]+)/.exec(version);
  return prerelease?.[1] ?? 'latest';
}

async function fetchRegistry(packageName) {
  const encoded = encodeURIComponent(packageName).replace(/^%40/, '@');
  const url = `${REGISTRY}/${encoded}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

for (const pkg of publishable) {
  const registry = await fetchRegistry(pkg.packageName);
  if (!registry) {
    missing.push(pkg.packageName);
    continue;
  }

  const expectedTag = expectedDistTag(pkg.manifestVersion);
  const taggedVersion = registry['dist-tags']?.[expectedTag];
  if (!taggedVersion) {
    failures.push(`${pkg.packageName}: no ${expectedTag} dist-tag on npm`);
    continue;
  }

  if (taggedVersion !== pkg.manifestVersion) {
    failures.push(
      `${pkg.packageName}: npm ${expectedTag} is ${taggedVersion}, manifest expects ${pkg.manifestVersion}`,
    );
  }

  const latestVersion = registry.versions?.[taggedVersion];
  if (!latestVersion) {
    failures.push(`${pkg.packageName}: no data for ${expectedTag} version ${taggedVersion}`);
    continue;
  }

  const expectedHomepage = pkg.packageJson.homepage;
  if (expectedHomepage && latestVersion.homepage !== expectedHomepage) {
    failures.push(
      `${pkg.packageName}: npm homepage "${latestVersion.homepage}" !== package.json "${expectedHomepage}"`,
    );
  }

  const expectedLicense = pkg.packageJson.license;
  if (expectedLicense && latestVersion.license !== expectedLicense) {
    failures.push(
      `${pkg.packageName}: npm license "${latestVersion.license}" !== package.json "${expectedLicense}"`,
    );
  }

  const expectedRepo = pkg.packageJson.repository;
  if (expectedRepo) {
    const regRepo = latestVersion.repository;
    if (regRepo?.url !== expectedRepo.url) {
      failures.push(
        `${pkg.packageName}: npm repository.url "${regRepo?.url}" !== package.json "${expectedRepo.url}"`,
      );
    }
    if (regRepo?.directory !== expectedRepo.directory) {
      failures.push(
        `${pkg.packageName}: npm repository.directory "${regRepo?.directory}" !== package.json "${expectedRepo.directory}"`,
      );
    }
  }

  if (latestVersion.name !== pkg.packageName) {
    failures.push(
      `${pkg.packageName}: npm name "${latestVersion.name}" !== expected "${pkg.packageName}"`,
    );
  }

  // Check exports parity: compare npm-published exports against local public-surface.json
  try {
    const surfacePath = `${pkg.path}/public-surface.json`;
    const surface = JSON.parse(readFileSync(surfacePath, 'utf8'));
    const localExports = [...surface.exports].sort();
    const regExports = latestVersion.exports;
    if (regExports) {
      const npmExportKeys = Object.keys(regExports).sort();
      if (JSON.stringify(localExports) !== JSON.stringify(npmExportKeys)) {
        failures.push(
          `${pkg.packageName}: npm exports ${JSON.stringify(npmExportKeys)} !== public-surface.json ${JSON.stringify(localExports)}`,
        );
      }
    }
  } catch {
    // No public-surface.json for this package — skip exports check
  }
}

const summary = {
  checked: publishable.length,
  verified: publishable.length - missing.length,
  missing_from_npm: missing,
  failures: failures.length,
};

if (missing.length > 0) {
  failures.push(`Packages not found on npm: ${missing.join(', ')}`);
}

if (failures.length > 0) {
  console.error('Package registry parity check failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Package registry parity: ${summary.verified}/${summary.checked} verified, 0 failures.`,
);
