#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getWorkspacePackages, readJson, readText, fail } from './check-utils.mjs';

const CANONICAL_REPOSITORY = 'oaslananka/a2amesh';
const PUBLISH_ENVIRONMENT = 'npm-publish';
const PUBLISH_WORKFLOW = '.github/workflows/publish.yml';
const TAG_PATTERN = /^@a2amesh\/runtime-v(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const ALLOWED_PUBLIC_PACKAGE_NAMES = new Set([
  '@a2amesh/protocol',
  '@a2amesh/runtime',
  '@a2amesh/registry',
  '@a2amesh/mcp',
  '@a2amesh/cli',
  '@a2amesh/create-a2amesh',
]);

const failures = [];
const options = parseArgs(process.argv.slice(2));
const tag = options.tag ?? process.env.TAG ?? process.env.INPUT_TAG ?? process.env.GITHUB_REF_NAME;
const rootPackage = readJson('package.json');
const config = readJson('release-please-config.json');
const manifest = readJson('.release-please-manifest.json');
const runtimeVersions = readJson('tools/runtime-versions.json');
const publishWorkflow = readText(PUBLISH_WORKFLOW);
const releasePleaseWorkflow = readText('.github/workflows/release-please.yml');
const warnings = [];

const currentRepository = process.env.GITHUB_REPOSITORY ?? getRemoteRepository();
if (currentRepository !== CANONICAL_REPOSITORY) {
  failures.push(
    `Publish repository must be ${CANONICAL_REPOSITORY}; resolved ${currentRepository}`,
  );
}

let expectedVersion = options.expectedVersion;
if (tag) {
  const match = TAG_PATTERN.exec(tag);
  if (!match?.groups?.version) {
    failures.push(`Release tag must match @a2amesh/runtime-v<semver>; received ${tag}`);
  } else {
    expectedVersion = expectedVersion ?? match.groups.version;
  }
}

if (expectedVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expectedVersion)) {
  failures.push(
    `Expected version must be semver x.y.z with an optional prerelease; received ${expectedVersion}`,
  );
}

if (rootPackage.private !== true) failures.push('Root package.json must remain private');
const expectedPackageManager = `pnpm@${runtimeVersions.pnpm}`;
if (rootPackage.packageManager !== expectedPackageManager) {
  failures.push(`Root packageManager must remain ${expectedPackageManager}`);
}
if (rootPackage.engines?.node !== '>=22.22.1 <25') {
  failures.push('Root package.json engines.node must be >=22.22.1 <25');
}
if (rootPackage.engines?.pnpm !== '>=11 <12') {
  failures.push('Root package.json engines.pnpm must be >=11 <12');
}
if (!existsSync('pnpm-lock.yaml')) failures.push('pnpm-lock.yaml must be present before publish');

const workspacePackages = getWorkspacePackages();
const publishablePackages = workspacePackages
  .filter(
    ({ dir, packageJson }) =>
      packageJson.private !== true &&
      dir.startsWith('packages/') &&
      typeof packageJson.name === 'string' &&
      typeof packageJson.version === 'string',
  )
  .sort((a, b) => a.packageJson.name.localeCompare(b.packageJson.name));

const releaseConfigByName = new Map();
for (const [path, releaseConfig] of Object.entries(config.packages ?? {})) {
  const packageJsonPath = `${path}/package.json`;
  if (!existsSync(packageJsonPath)) {
    failures.push(`${path}: release-please package path is missing package.json`);
    continue;
  }
  const packageJson = readJson(packageJsonPath);
  const packageName = releaseConfig?.['package-name'];
  if (packageName !== packageJson.name) {
    failures.push(`${path}: release-please package-name must match package.json name`);
  }
  if (releaseConfig?.component !== packageName) {
    failures.push(`${path}: release-please component must match package name`);
  }
  if (manifest[path] !== packageJson.version) {
    failures.push(`${path}: .release-please-manifest.json must match package.json version`);
  }
  if (expectedVersion && manifest[path] !== expectedVersion) {
    failures.push(
      `${path}: manifest version ${manifest[path]} must match tag version ${expectedVersion}`,
    );
  }
  releaseConfigByName.set(packageName, { path, version: packageJson.version });
}

for (const { dir, packageJson } of publishablePackages) {
  const name = packageJson.name;
  if (!ALLOWED_PUBLIC_PACKAGE_NAMES.has(name)) {
    failures.push(`${dir}: public package name ${name} is outside the approved npm namespace`);
  }
  if (packageJson.private === true)
    failures.push(`${dir}: publishable package must not be private`);
  if (packageJson.publishConfig?.access !== 'public') {
    failures.push(`${dir}: publishConfig.access must be public for npm publishing`);
  }
  if (packageJson.publishConfig?.provenance !== true) {
    failures.push(`${dir}: publishConfig.provenance must be true for npm Trusted Publishing`);
  }
  if (packageJson.engines?.node !== rootPackage.engines.node) {
    failures.push(
      `${dir}: engines.node must match root engines.node (${rootPackage.engines.node})`,
    );
  }
  const inReleasePlease = releaseConfigByName.has(name);
  if (!inReleasePlease) {
    failures.push(
      `${dir}: public package ${name} must be in release-please-config.json or explicitly listed as independently versioned`,
    );
  }
}

const linkedVersionComponents = new Set(
  (config.plugins ?? [])
    .filter((plugin) => plugin?.type === 'linked-versions')
    .flatMap((plugin) => plugin.components ?? []),
);
for (const packageName of releaseConfigByName.keys()) {
  if (!linkedVersionComponents.has(packageName)) {
    failures.push(
      `${packageName}: release-please package must be included in linked-versions components`,
    );
  }
}
for (const component of linkedVersionComponents) {
  if (!releaseConfigByName.has(component)) {
    failures.push(
      `${component}: linked-versions component is missing from release-please packages`,
    );
  }
}

if (!publishWorkflow.includes('workflow_dispatch:')) {
  failures.push('publish.yml must be manually dispatched with workflow_dispatch');
}
if (!publishWorkflow.includes(`environment: ${PUBLISH_ENVIRONMENT}`)) {
  failures.push(`publish.yml must use the ${PUBLISH_ENVIRONMENT} environment`);
}
if (!/id-token:\s*write/.test(publishWorkflow)) {
  failures.push('publish.yml must grant id-token: write for npm OIDC Trusted Publishing');
}
if (!/attestations:\s*write/.test(publishWorkflow)) {
  failures.push('publish.yml must grant attestations: write for provenance attestations');
}
if (!publishWorkflow.includes('registry-url: https://registry.npmjs.org')) {
  failures.push('publish.yml setup-pnpm step must configure the npm registry URL');
}
if (!publishWorkflow.includes('npm publish "$package_file" --access public --provenance')) {
  failures.push('publish.yml must publish tarballs with --access public --provenance');
}
if (!publishWorkflow.includes('@a2amesh/runtime-v<semver>')) {
  failures.push('publish.yml must document the expected release tag format');
}
if (/NODE_AUTH_TOKEN|NPM_TOKEN/.test(publishWorkflow)) {
  failures.push('publish.yml must not use long-lived npm token authentication');
}
if (!releasePleaseWorkflow.includes('skip-github-release: true')) {
  failures.push('Release Please must leave GitHub Release creation to maintainers');
}

if (failures.length > 0) {
  fail('Publish preflight failed.', failures);
  process.exit(1);
}

const summary = {
  repository: currentRepository,
  tag: tag ?? null,
  expected_version: expectedVersion ?? null,
  publish_environment: PUBLISH_ENVIRONMENT,
  workflow: PUBLISH_WORKFLOW,
  publishable_packages: publishablePackages.map(({ dir, packageJson }) => ({
    name: packageJson.name,
    path: dir,
    version: packageJson.version,
    release_please: releaseConfigByName.has(packageJson.name),
    independently_versioned: false,
  })),
  warnings,
};

console.log(JSON.stringify(summary, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--tag') parsed.tag = args[++i];
    else if (arg.startsWith('--tag=')) parsed.tag = arg.slice('--tag='.length);
    else if (arg === '--expected-version') parsed.expectedVersion = args[++i];
    else if (arg.startsWith('--expected-version=')) {
      parsed.expectedVersion = arg.slice('--expected-version='.length);
    } else {
      failures.push(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function getRemoteRepository() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/.exec(url);
    return match?.groups ? `${match.groups.owner}/${match.groups.repo}` : CANONICAL_REPOSITORY;
  } catch {
    return CANONICAL_REPOSITORY;
  }
}
