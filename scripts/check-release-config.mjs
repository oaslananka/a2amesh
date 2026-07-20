import { readJson, readText, fail } from './check-utils.mjs';

const APPROVED_RELEASES = new Map([
  ['packages/protocol', '@a2amesh/protocol'],
  ['packages/runtime', '@a2amesh/runtime'],
  ['packages/registry', '@a2amesh/registry'],
  ['packages/mcp', '@a2amesh/mcp'],
  ['packages/cli', '@a2amesh/cli'],
  ['packages/create-a2amesh', '@a2amesh/create-a2amesh'],
]);

const config = readJson('release-please-config.json');
const manifest = readJson('.release-please-manifest.json');
const rootPackage = readJson('package.json');
const failures = [];

if (rootPackage.name !== 'a2amesh-workspace') {
  failures.push('root package must be named a2amesh-workspace');
}
if (rootPackage.private !== true) failures.push('root package must remain private');
if (typeof rootPackage.version !== 'string' || rootPackage.version.length === 0) {
  failures.push('root package must keep a non-empty version');
}

const configuredPaths = Object.keys(config.packages ?? {}).sort();
const approvedPaths = [...APPROVED_RELEASES.keys()].sort();
if (JSON.stringify(configuredPaths) !== JSON.stringify(approvedPaths)) {
  failures.push(`release config paths must be exactly: ${approvedPaths.join(', ')}`);
}
const manifestPaths = Object.keys(manifest).sort();
if (JSON.stringify(manifestPaths) !== JSON.stringify(approvedPaths)) {
  failures.push(`release manifest paths must be exactly: ${approvedPaths.join(', ')}`);
}
const manifestVersions = approvedPaths.map((path) => manifest[path]);
const uniqueManifestVersions = new Set(manifestVersions);
if (manifestVersions.some((version) => typeof version !== 'string' || version.length === 0)) {
  failures.push('release manifest versions must be non-empty strings');
}
if (uniqueManifestVersions.size > 1) {
  failures.push(
    `linked public packages must share one release version, found: ${[...uniqueManifestVersions].join(', ')}`,
  );
}

for (const [path, expectedName] of APPROVED_RELEASES) {
  const packageJson = readJson(`${path}/package.json`);
  const releaseConfig = config.packages?.[path];
  const expectedVersion = manifest[path];
  if (packageJson.name !== expectedName)
    failures.push(`${path}: package name must be ${expectedName}`);
  if (packageJson.version !== expectedVersion) {
    failures.push(`${path}: version must match release manifest version ${expectedVersion}`);
  }
  if (packageJson.private === true)
    failures.push(`${path}: approved public package must not be private`);
  if (packageJson.publishConfig?.access !== 'public') {
    failures.push(`${path}: publishConfig.access must be public`);
  }
  if (manifest[path] !== packageJson.version) {
    failures.push(`${path}: release manifest must match package version ${packageJson.version}`);
  }
  if (releaseConfig?.['package-name'] !== expectedName) {
    failures.push(`${path}: release package-name must be ${expectedName}`);
  }
  if (releaseConfig?.component !== expectedName) {
    failures.push(`${path}: release component must be ${expectedName}`);
  }
}

const linkedComponents = new Set(
  (config.plugins ?? [])
    .filter((plugin) => plugin?.type === 'linked-versions')
    .flatMap((plugin) => plugin.components ?? []),
);
for (const expectedName of APPROVED_RELEASES.values()) {
  if (!linkedComponents.has(expectedName))
    failures.push(`${expectedName}: missing linked-version component`);
}
for (const component of linkedComponents) {
  if (![...APPROVED_RELEASES.values()].includes(component)) {
    failures.push(`${component}: internal package must not be release tracked`);
  }
}

const configText = JSON.stringify(config);
if (/npm_token/i.test(configText)) failures.push('release config must not reference npm tokens');

const publishWorkflow = readText('.github/workflows/publish.yml');
const releasePleaseWorkflow = readText('.github/workflows/release-please.yml');
if (!publishWorkflow.includes('confirmation:')) {
  failures.push('publish workflow must require an explicit confirmation input');
}
if (!publishWorkflow.includes('PUBLISH ${TAG}')) {
  failures.push('publish workflow confirmation must include the resolved tag');
}
if (/^\s+release:\s*$/m.test(publishWorkflow) || /^\s+push:\s*$/m.test(publishWorkflow)) {
  failures.push('publish workflow must be owner-dispatched only');
}
if (!/id-token:\s*write/.test(publishWorkflow)) {
  failures.push('publish workflow must grant id-token: write for Trusted Publishing');
}
if (!/attestations:\s*write/.test(publishWorkflow)) {
  failures.push('publish workflow must grant attestations: write for artifact provenance');
}
if (/NODE_AUTH_TOKEN|NPM_TOKEN/.test(publishWorkflow)) {
  failures.push('publish workflow must not use long-lived npm token authentication');
}
if (/fallback/i.test(publishWorkflow)) {
  failures.push('publish workflow must not fall back to token publishing');
}
if (!publishWorkflow.includes('npm publish "$package_file" --access public --provenance')) {
  failures.push('publish workflow must publish reviewed tarballs with provenance');
}
if (!publishWorkflow.includes('pnpm run release:artifacts')) {
  failures.push('publish workflow must generate release artifacts');
}
if (!publishWorkflow.includes('pnpm run release:validate')) {
  failures.push('publish workflow must validate release artifacts');
}
if (!publishWorkflow.includes('node scripts/check-publish-preflight.mjs')) {
  failures.push('publish workflow must run the publish preflight');
}
if (!releasePleaseWorkflow.includes('skip-github-release: true')) {
  failures.push('Release Please must not create GitHub Releases');
}
const releasePleaseGate = 'node scripts/release-state.mjs --mode release-please --json';
const releasePleaseAction = 'googleapis/release-please-action';
if (!releasePleaseWorkflow.includes(releasePleaseGate)) {
  failures.push('Release Please workflow must run the release-state release-please gate');
} else if (
  releasePleaseWorkflow.indexOf(releasePleaseGate) >
  releasePleaseWorkflow.indexOf(releasePleaseAction)
) {
  failures.push('Release Please release-state gate must run before release-please-action');
}
if (!publishWorkflow.includes('Stage release-state guard scripts')) {
  failures.push(
    'Publish workflow must stage current release-state guard scripts before tag checkout',
  );
}
if (
  !publishWorkflow.includes(
    'cp scripts/release-state.mjs scripts/release-state-core.mjs "${RUNNER_TEMP}/release-state-guard/"',
  )
) {
  failures.push(
    'Publish workflow must preserve both release-state guard modules before tag checkout',
  );
}
if (!publishWorkflow.includes('ref: ${{ steps.tag.outputs.tag }}')) {
  failures.push('Publish workflow must check out the requested canonical tag');
}
if (
  !publishWorkflow.includes(
    'node "${RUNNER_TEMP}/release-state-guard/release-state.mjs" --mode publish --json --tag "${TAG}"',
  )
) {
  failures.push(
    'Publish workflow must run the staged release-state publish gate with the requested tag',
  );
}
if (publishWorkflow.includes('node scripts/release-state.mjs --check')) {
  failures.push('Publish workflow must not use the ambiguous legacy release-state --check mode');
}

if (failures.length > 0) fail('Release config validation failed.', failures);
