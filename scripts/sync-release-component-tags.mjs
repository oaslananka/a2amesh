import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_TAG_DEPTH = 8;

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function buildReleaseComponentTagPlan({ config, manifest, version }) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }

  const packages = config?.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error('release-please-config.json must define a packages object.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('.release-please-manifest.json must be an object.');
  }

  const plan = Object.entries(packages)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, packageConfig]) => {
      const component = assertNonEmptyString(packageConfig?.component, `${path} component`);
      const manifestVersion = assertNonEmptyString(manifest[path], `${path} manifest version`);
      if (manifestVersion !== version) {
        throw new Error(`${path} manifest version ${manifestVersion} does not match ${version}.`);
      }
      return {
        component,
        path,
        tag: `${component}-v${version}`,
      };
    });

  const configuredPaths = new Set(Object.keys(packages));
  for (const path of Object.keys(manifest)) {
    if (!configuredPaths.has(path)) {
      throw new Error(`${path} is present in the release manifest but not the release config.`);
    }
  }

  const uniqueTags = new Set(plan.map(({ tag }) => tag));
  if (uniqueTags.size !== plan.length) {
    throw new Error('Release Please component tags must be unique.');
  }
  if (!plan.some(({ component }) => component === '@a2amesh/runtime')) {
    throw new Error('Release component tag plan must include @a2amesh/runtime.');
  }

  return plan;
}

function errorStatus(error) {
  if (error && typeof error === 'object' && 'status' in error) {
    return Number(error.status);
  }
  return undefined;
}

async function resolveTagCommit({ github, repository, tag }) {
  const encodedTag = encodeURIComponent(tag);
  const ref = await github.request('GET', `/repos/${repository}/git/ref/tags/${encodedTag}`);
  let object = ref?.object;

  for (let depth = 0; depth < MAX_TAG_DEPTH; depth += 1) {
    if (object?.type === 'commit') return assertNonEmptyString(object.sha, `${tag} commit`);
    if (object?.type !== 'tag') {
      throw new Error(
        `${tag} resolves to unsupported git object type ${object?.type ?? '<missing>'}.`,
      );
    }
    const tagObjectSha = assertNonEmptyString(object.sha, `${tag} tag object`);
    const tagObject = await github.request('GET', `/repos/${repository}/git/tags/${tagObjectSha}`);
    object = tagObject?.object;
  }

  throw new Error(`${tag} exceeds the supported annotated tag depth.`);
}

async function findTagCommit(options) {
  try {
    return await resolveTagCommit(options);
  } catch (error) {
    if (errorStatus(error) === 404) return null;
    throw error;
  }
}

function validateSyncOptions({ repository, commit, version, tags, github }) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  assertNonEmptyString(commit, 'Release commit');
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('At least one Release Please component tag is required.');
  }
  if (!github || typeof github.request !== 'function') {
    throw new Error('A GitHub API client is required.');
  }
}

function assertTagCommit(tag, actualCommit, expectedCommit) {
  if (actualCommit !== expectedCommit) {
    throw new Error(`${tag} points to ${actualCommit} instead of ${expectedCommit}.`);
  }
}

async function observeReleaseComponentTag({ github, repository, commit, entry, verifyOnly }) {
  const existingCommit = await findTagCommit({ github, repository, tag: entry.tag });
  if (existingCommit) {
    assertTagCommit(entry.tag, existingCommit, commit);
    return { entry, existingCommit };
  }
  if (verifyOnly) {
    throw new Error(`Missing Release Please component tag ${entry.tag} for ${commit}.`);
  }
  return { entry, existingCommit: null };
}

async function createReleaseComponentTag({ github, repository, commit, version, entry }) {
  const tagObject = await github.request('POST', `/repos/${repository}/git/tags`, {
    tag: entry.tag,
    message: `Release ${entry.component} ${version}`,
    object: commit,
    type: 'commit',
  });
  const tagObjectSha = assertNonEmptyString(tagObject?.sha, `${entry.tag} tag object`);

  try {
    await github.request('POST', `/repos/${repository}/git/refs`, {
      ref: `refs/tags/${entry.tag}`,
      sha: tagObjectSha,
    });
    return { tag: entry.tag, commit, status: 'created' };
  } catch (error) {
    if (errorStatus(error) !== 422) throw error;
    const racedCommit = await resolveTagCommit({ github, repository, tag: entry.tag });
    assertTagCommit(entry.tag, racedCommit, commit);
    return { tag: entry.tag, commit, status: 'verified' };
  }
}

async function materializeReleaseComponentTag({
  github,
  repository,
  commit,
  version,
  observation,
}) {
  if (observation.existingCommit) {
    return { tag: observation.entry.tag, commit, status: 'verified' };
  }
  return createReleaseComponentTag({
    github,
    repository,
    commit,
    version,
    entry: observation.entry,
  });
}

export async function syncReleaseComponentTags({
  repository,
  commit,
  version,
  tags,
  github,
  verifyOnly = false,
}) {
  validateSyncOptions({ repository, commit, version, tags, github });

  const observations = [];
  for (const entry of tags) {
    observations.push(
      await observeReleaseComponentTag({
        github,
        repository,
        commit,
        entry,
        verifyOnly,
      }),
    );
  }

  const results = [];
  for (const observation of observations) {
    results.push(
      await materializeReleaseComponentTag({
        github,
        repository,
        commit,
        version,
        observation,
      }),
    );
  }
  return results;
}

export function createGitHubClient({
  token,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
}) {
  assertNonEmptyString(token, 'GitHub token');

  return {
    async request(method, path, body) {
      const response = await fetchImpl(`${apiUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'a2amesh-release-component-tags',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let data = null;
      if (text.length > 0) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok) {
        const message =
          data && typeof data === 'object' && 'message' in data
            ? String(data.message)
            : `GitHub API request failed with status ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      return data;
    },
  };
}

export function parseArgs(argv) {
  const options = { verifyOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--verify-only') {
      options.verifyOnly = true;
      continue;
    }
    if (['--repo', '--version', '--commit'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.commit) {
    throw new Error('--commit is required.');
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function uniqueManifestVersion(manifest) {
  const versions = [...new Set(Object.values(manifest))];
  if (versions.length !== 1 || !VERSION_PATTERN.test(versions[0])) {
    throw new Error(
      `Release manifest must contain one valid linked version, found: ${versions.join(', ')}`,
    );
  }
  return versions[0];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [config, manifest] = await Promise.all([
    readJson('release-please-config.json'),
    readJson('.release-please-manifest.json'),
  ]);
  const version = options.version ?? uniqueManifestVersion(manifest);
  const repository = options.repo ?? process.env.GITHUB_REPOSITORY;
  const commit = options.commit;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const tags = buildReleaseComponentTagPlan({ config, manifest, version });
  const results = await syncReleaseComponentTags({
    repository,
    commit,
    version,
    tags,
    github: createGitHubClient({ token, apiUrl: process.env.GITHUB_API_URL }),
    verifyOnly: options.verifyOnly,
  });

  console.log(
    JSON.stringify(
      {
        repository,
        version,
        commit,
        mode: options.verifyOnly ? 'verify-only' : 'synchronize',
        tags: results,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
