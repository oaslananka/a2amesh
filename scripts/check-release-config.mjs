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

const pluginManifestPath = '.claude-plugin/plugin.json';
const pluginReleasePath = `/${pluginManifestPath}`;
const cliReleaseConfig = config.packages?.['packages/cli'];
const pluginExtraFiles = cliReleaseConfig?.['extra-files'] ?? [];
if (
  !pluginExtraFiles.some(
    (entry) =>
      entry?.type === 'json' &&
      entry?.path === pluginReleasePath &&
      entry?.jsonpath === '$.version',
  )
) {
  failures.push(
    `${pluginManifestPath}: packages/cli must update the product plugin version through the repository-root JSON extra-file`,
  );
}
const pluginManifest = readJson(pluginManifestPath);
if (pluginManifest.version !== manifest['packages/cli']) {
  failures.push(
    `${pluginManifestPath}: version must match the linked @a2amesh/cli release version`,
  );
}

const chartPath = 'deploy/helm/a2amesh/Chart.yaml';
const chartReleasePath = `/${chartPath}`;
const runtimeReleaseConfig = config.packages?.['packages/runtime'];
const chartExtraFiles = runtimeReleaseConfig?.['extra-files'] ?? [];
if (
  !chartExtraFiles.some((entry) => entry?.type === 'generic' && entry?.path === chartReleasePath)
) {
  failures.push(
    `${chartPath}: packages/runtime must use the repository-root generic extra-files path ${chartReleasePath}`,
  );
}
const chart = readText(chartPath);
const runtimeVersion = manifest['packages/runtime'];
for (const field of ['version', 'appVersion']) {
  const expected = `${field}: ${runtimeVersion} # x-release-please-version`;
  if (!chart.includes(expected)) {
    failures.push(`${chartPath}: ${field} must match runtime and carry x-release-please-version`);
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
for (const stableConfirmationFragment of [
  'STABLE_RELEASE_TAG_PATTERN',
  'if [[ "${TAG}" =~ ${STABLE_RELEASE_TAG_PATTERN} ]]',
  'PUBLISH STABLE ${TAG}',
]) {
  if (!publishWorkflow.includes(stableConfirmationFragment)) {
    failures.push(
      `publish workflow stable confirmation contract is missing: ${stableConfirmationFragment}`,
    );
  }
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
if (!releasePleaseWorkflow.includes('include-component-in-tag: true')) {
  failures.push('Release Please must use component-prefixed tags for linked packages');
}
if (!releasePleaseWorkflow.includes('node scripts/sync-security-policy.mjs')) {
  failures.push('Release Please must synchronize the security support policy');
}
const releasePrPolicySync =
  'node scripts/sync-release-pr-policy.mjs --clear-release-as --sync-install-docs --sync-repository-evidence';
if (!releasePleaseWorkflow.includes(releasePrPolicySync)) {
  failures.push(
    'Release Please must synchronize release-channel/install/evidence policy and clear one-shot release-as',
  );
}
for (const releaseEvidenceFragment of [
  'RELEASE_PR_JSON: ${{ steps.release.outputs.pr }}',
  'corepack pnpm install --frozen-lockfile',
]) {
  if (!releasePleaseWorkflow.includes(releaseEvidenceFragment)) {
    failures.push(
      `Release Please staged-evidence synchronization is missing: ${releaseEvidenceFragment}`,
    );
  }
}
const releasePrCheckout =
  /ref: \$\{\{ steps\.release_pr\.outputs\.branch \}\}[\s\S]*?fetch-depth: 0[\s\S]*?persist-credentials: false/;
if (!releasePrCheckout.test(releasePleaseWorkflow)) {
  failures.push('Release Please must check out the release pull request branch with full history');
}
const releasePrWorkspacePreparation =
  /corepack pnpm install --frozen-lockfile[\s\S]*?name: Verify release pull request branch is clean[\s\S]*?git status --porcelain[\s\S]*?corepack pnpm run build[\s\S]*?name: Sync generated files and release policies/;
if (!releasePrWorkspacePreparation.test(releasePleaseWorkflow)) {
  failures.push(
    'Release Please must verify a clean candidate, then build it before policy synchronization',
  );
}
for (const releasePrSafetyFragment of [
  'git status --porcelain',
  'git ls-files --others --exclude-standard',
  'git diff --check',
  'git add -u',
  'git diff --cached --check',
]) {
  if (!releasePleaseWorkflow.includes(releasePrSafetyFragment)) {
    failures.push(
      `Release Please policy synchronization guard is missing: ${releasePrSafetyFragment}`,
    );
  }
}
const releasePleaseGate = 'node scripts/release-state.mjs --mode release-please --json';
const releasePleaseComponentTags = 'name: Verify published component tags';
const releasePleaseAction = 'googleapis/release-please-action';
if (!releasePleaseWorkflow.includes(releasePleaseGate)) {
  failures.push('Release Please workflow must run the release-state release-please gate');
} else if (
  releasePleaseWorkflow.indexOf(releasePleaseGate) >
  releasePleaseWorkflow.indexOf(releasePleaseAction)
) {
  failures.push('Release Please release-state gate must run before release-please-action');
}
if (!releasePleaseWorkflow.includes(releasePleaseComponentTags)) {
  failures.push('Release Please must verify published component tags before opening a PR');
} else if (
  releasePleaseWorkflow.indexOf(releasePleaseComponentTags) <
    releasePleaseWorkflow.indexOf(releasePleaseGate) ||
  releasePleaseWorkflow.indexOf(releasePleaseComponentTags) >
    releasePleaseWorkflow.indexOf(releasePleaseAction)
) {
  failures.push(
    'Release Please component-tag verification must run after state validation and before the action',
  );
}
if (!releasePleaseWorkflow.includes('sync-release-component-tags.mjs')) {
  failures.push('Release Please must use the component-tag synchronizer');
}
if (!releasePleaseWorkflow.includes('--verify-only')) {
  failures.push('Release Please component-tag validation must be verify-only');
}
const publishMainRefGuard =
  "if: github.repository == 'oaslananka/a2amesh' && github.ref == 'refs/heads/main'";
if (!publishWorkflow.includes(publishMainRefGuard)) {
  failures.push('Publish workflow must run only from the canonical main branch ref');
}
if (!publishWorkflow.includes('Stage release-state guard scripts')) {
  failures.push(
    'Publish workflow must stage current release-state guard scripts before tag checkout',
  );
}
if (
  !publishWorkflow.includes(
    'cp scripts/release-state.mjs scripts/release-state-core.mjs .release-recovery.json "${RUNNER_TEMP}/release-state-guard/"',
  )
) {
  failures.push(
    'Publish workflow must preserve both release-state guard modules and the recovery ledger before tag checkout',
  );
}
if (
  !publishWorkflow.includes(
    'cp scripts/sync-release-component-tags.mjs "${RUNNER_TEMP}/release-state-guard/"',
  )
) {
  failures.push('Publish workflow must stage the current component-tag synchronizer');
}
if (!publishWorkflow.includes('ref: ${{ steps.tag.outputs.tag }}')) {
  failures.push('Publish workflow must check out the requested canonical tag');
}
if (
  !publishWorkflow.includes(
    'node "${RUNNER_TEMP}/release-state-guard/release-state.mjs" --mode "${MODE}" --json --tag "${TAG}" --recovery-file "${RUNNER_TEMP}/release-state-guard/.release-recovery.json"',
  )
) {
  failures.push(
    'Publish workflow must run the staged operation-specific release-state gate with the requested tag and current recovery ledger',
  );
}
for (const requiredFragment of [
  'operation:',
  '- retain-assets',
  'RETAIN ${TAG}',
  "if: steps.tag.outputs.operation == 'publish'",
]) {
  if (!publishWorkflow.includes(requiredFragment)) {
    failures.push(`Publish workflow asset-retention contract is missing: ${requiredFragment}`);
  }
}
const registryParityStep = 'name: Verify package registry parity';
const componentTagStep = 'name: Synchronize Release Please component tags';
const releaseAssetStep = 'name: Upload verified release assets';
if (!publishWorkflow.includes(componentTagStep)) {
  failures.push('Publish workflow must synchronize Release Please component tags');
} else if (
  publishWorkflow.indexOf(componentTagStep) < publishWorkflow.indexOf(registryParityStep) ||
  publishWorkflow.indexOf(componentTagStep) > publishWorkflow.indexOf(releaseAssetStep)
) {
  failures.push(
    'Publish component-tag synchronization must run after registry parity and before asset upload',
  );
}
if (
  !publishWorkflow.includes(
    'node "${RUNNER_TEMP}/release-state-guard/sync-release-component-tags.mjs"',
  )
) {
  failures.push('Publish workflow must run the staged component-tag synchronizer');
}

if (publishWorkflow.includes('node scripts/release-state.mjs --check')) {
  failures.push('Publish workflow must not use the ambiguous legacy release-state --check mode');
}

if (failures.length > 0) fail('Release config validation failed.', failures);
