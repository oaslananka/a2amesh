#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { format } from 'prettier';
import {
  injectRepositoryEvidence,
  renderRepositoryEvidence,
  validateMaturityReport,
  validateRepositoryEvidence,
} from './repository-evidence-core.mjs';

const SNAPSHOT_PATH = 'docs/governance/repository-evidence.json';
const REPORT_PATH = 'docs/repo-maturity-report.md';
const options = parseArgs(process.argv.slice(2));
process.chdir(options.root);

try {
  if (options.write) await writeEvidence(options);
  else await checkEvidence(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function writeEvidence(options) {
  const snapshot = options.input ? readJson(options.input) : collectLiveSnapshot();
  const snapshotPath = resolve(SNAPSHOT_PATH);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  const report = readFileSync(REPORT_PATH, 'utf8');
  const rendered = renderRepositoryEvidence(snapshot);
  const updatedReport = await format(injectRepositoryEvidence(report, rendered), {
    parser: 'markdown',
  });
  writeFileSync(REPORT_PATH, updatedReport);
  await checkEvidence({ ...options, now: new Date() });
  console.log('Repository evidence refreshed.');
}

async function checkEvidence(options) {
  const snapshot = readJson(SNAPSHOT_PATH);
  const report = readFileSync(REPORT_PATH, 'utf8');
  const localState = readLocalState();
  const now = options.now instanceof Date ? options.now : new Date();
  const failures = validateRepositoryEvidence(snapshot, localState, now);
  failures.push(...validateMaturityReport(report));

  const rendered = renderRepositoryEvidence(snapshot);
  let expectedReport;
  try {
    expectedReport = await format(injectRepositoryEvidence(report, rendered), {
      parser: 'markdown',
    });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (expectedReport !== undefined && expectedReport !== report) {
    failures.push('Generated repository evidence section is stale; run repository:evidence:write');
  }

  if (failures.length > 0) {
    console.error('Repository evidence validation failed.');
    for (const failure of new Set(failures)) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('Repository evidence validation passed.');
}

function readLocalState() {
  const manifest = readJson('.release-please-manifest.json');
  const releaseConfig = readJson('release-please-config.json');
  const packageVersions = Object.fromEntries(
    Object.keys(releaseConfig.packages ?? {}).map((path) => [
      path,
      readJson(`${path}/package.json`).version,
    ]),
  );
  return { manifest, releaseConfig, packageVersions };
}

function collectLiveSnapshot() {
  const repositoryName = process.env.GITHUB_REPOSITORY ?? getRemoteRepository();
  const repository = ghJson(['api', `repos/${repositoryName}`]);
  const pullRequests = ghJson([
    'pr',
    'list',
    '--repo',
    repositoryName,
    '--state',
    'open',
    '--limit',
    '1000',
    '--json',
    'number,title,url,headRefName,createdAt,updatedAt',
  ]);
  const issues = ghJson([
    'issue',
    'list',
    '--repo',
    repositoryName,
    '--state',
    'open',
    '--limit',
    '1000',
    '--json',
    'number,title,url,createdAt,updatedAt',
  ]);
  const localState = readLocalState();
  const sourceVersions = uniqueValues(Object.values(localState.manifest));
  if (sourceVersions.length !== 1) {
    throw new Error(
      `Cannot collect evidence with divergent source versions: ${sourceVersions.join(', ')}`,
    );
  }
  const sourceVersion = sourceVersions[0];
  const expectedTag = `@a2amesh/runtime-v${sourceVersion}`;
  const tags = ghJson(['api', `repos/${repositoryName}/tags?per_page=100`]);
  const canonicalTag = tags.find((tag) => tag.name === expectedTag);
  if (!canonicalTag?.commit?.sha) throw new Error(`Canonical tag ${expectedTag} was not found`);

  const releasePrs = pullRequests.filter(
    (pullRequest) => pullRequest.headRefName === 'release-please--branches--main',
  );
  if (releasePrs.length > 1) {
    throw new Error(
      `Multiple active Release Please pull requests were found: ${releasePrs.length}`,
    );
  }
  const activeReleasePr = releasePrs[0]
    ? collectReleasePullRequest(repositoryName, releasePrs[0])
    : null;
  const latestGithubRelease = collectLatestGithubRelease(repositoryName);
  const npmMetadata = fetchJson('https://registry.npmjs.org/%40a2amesh%2Fruntime');
  const today = new Date().toISOString().slice(0, 10);
  const accessInventory = readJson('docs/security/github-actions-access-inventory.json');
  const settingsOwner = accessInventory.settings_owner;
  const settingsCadence = accessInventory.refresh_cadence_days;
  const settings = collectSettings(repositoryName, repository.default_branch, {
    owner: settingsOwner,
    observedAt: today,
    cadence: settingsCadence,
    repository,
  });

  return {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    refresh_cadence_days: 14,
    repository: {
      name: repository.full_name,
      url: repository.html_url,
      default_branch: repository.default_branch,
      visibility: repository.visibility,
      archived: repository.archived,
      license: repository.license?.spdx_id ?? 'unknown',
      open_work: {
        issues: issues.length,
        pull_requests: pullRequests.length,
        total: repository.open_issues_count,
      },
    },
    release: {
      source_version: sourceVersion,
      package_paths: Object.keys(localState.releaseConfig.packages ?? {}).sort(compareStrings),
      latest_github_release: latestGithubRelease,
      latest_canonical_tag: {
        name: canonicalTag.name,
        commit: canonicalTag.commit.sha,
      },
      npm: {
        package: '@a2amesh/runtime',
        alpha: npmMetadata['dist-tags']?.alpha ?? null,
        latest: npmMetadata['dist-tags']?.latest ?? null,
      },
      active_release_pr: activeReleasePr,
    },
    settings,
    provenance: {
      repository: `GitHub REST API: GET /repos/${repositoryName}`,
      issues: `GitHub CLI: issue list --repo ${repositoryName} --state open`,
      pull_requests: `GitHub CLI: pr list --repo ${repositoryName} --state open`,
      releases: `GitHub REST API: releases/latest and tags for ${repositoryName}`,
      npm: 'npm registry metadata for @a2amesh/runtime',
      source_versions: '.release-please-manifest.json and release-tracked package.json files',
    },
  };
}

function collectReleasePullRequest(repositoryName, pullRequest) {
  const manifestResponse = ghJson([
    'api',
    `repos/${repositoryName}/contents/.release-please-manifest.json?ref=${encodeURIComponent(pullRequest.headRefName)}`,
  ]);
  const manifest = JSON.parse(Buffer.from(manifestResponse.content, 'base64').toString('utf8'));
  const versions = uniqueValues(Object.values(manifest));
  if (versions.length !== 1) {
    throw new Error(
      `Release Please PR #${pullRequest.number} proposes divergent versions: ${versions.join(', ')}`,
    );
  }
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    proposed_version: versions[0],
  };
}

function collectLatestGithubRelease(repositoryName) {
  try {
    const release = ghJson(['api', `repos/${repositoryName}/releases/latest`]);
    return {
      tag: release.tag_name,
      name: release.name,
      url: release.html_url,
      published_at: release.published_at,
      prerelease: release.prerelease,
    };
  } catch (error) {
    if (String(error).includes('HTTP 404')) return null;
    throw error;
  }
}

function collectSettings(repositoryName, defaultBranch, context) {
  const privateReporting = ghJson([
    'api',
    `repos/${repositoryName}/private-vulnerability-reporting`,
  ]);
  const branchProtection = ghJson([
    'api',
    `repos/${repositoryName}/branches/${defaultBranch}/protection`,
  ]);
  const reviewProtection = branchProtection.required_pull_request_reviews ?? {};
  const publishEnvironment = ghJson(['api', `repos/${repositoryName}/environments/npm-publish`]);
  const publishPolicies = ghJson([
    'api',
    `repos/${repositoryName}/environments/npm-publish/deployment-branch-policies`,
  ]);
  const publishSecrets = ghJson([
    'api',
    `repos/${repositoryName}/environments/npm-publish/secrets`,
  ]);
  const reviewerRule = publishEnvironment.protection_rules?.find(
    (rule) => rule.type === 'required_reviewers',
  );
  const reviewers =
    reviewerRule?.reviewers?.map((entry) => entry.reviewer?.login).filter(Boolean) ?? [];
  const branchNames = publishPolicies.branch_policies?.map((policy) => policy.name) ?? [];
  const security = context.repository.security_and_analysis ?? {};
  const shared = {
    owner: context.owner,
    observed_at: context.observedAt,
    refresh_cadence_days: context.cadence,
  };
  return [
    {
      name: 'Private vulnerability reporting',
      value: privateReporting.enabled ? 'enabled' : 'disabled',
      ...shared,
      source: 'GitHub REST API: private-vulnerability-reporting',
    },
    {
      name: 'Security analysis features',
      value: `secret scanning ${security.secret_scanning?.status ?? 'unknown'}; push protection ${security.secret_scanning_push_protection?.status ?? 'unknown'}; Dependabot security updates ${security.dependabot_security_updates?.status ?? 'unknown'}`,
      ...shared,
      source: `GitHub REST API: GET /repos/${repositoryName}`,
    },
    {
      name: `${defaultBranch} branch protection`,
      value: `${branchProtection.required_status_checks?.contexts?.length ?? 0} required status checks; strict updates ${branchProtection.required_status_checks?.strict ? 'enabled' : 'disabled'}; ${reviewProtection.required_approving_review_count ?? 0} required approvals; stale-review dismissal ${reviewProtection.dismiss_stale_reviews ? 'enabled' : 'disabled'}; code-owner review ${reviewProtection.require_code_owner_reviews ? 'enabled' : 'disabled'}; last-push approval ${reviewProtection.require_last_push_approval ? 'enabled' : 'disabled'}; admin enforcement ${branchProtection.enforce_admins?.enabled ? 'enabled' : 'disabled'}; force pushes ${branchProtection.allow_force_pushes?.enabled ? 'allowed' : 'blocked'}; deletion ${branchProtection.allow_deletions?.enabled ? 'allowed' : 'blocked'}`,
      ...shared,
      source: 'GitHub REST API: branch protection',
    },
    {
      name: 'npm-publish environment',
      value: `branches ${branchNames.join(', ') || 'none'}; reviewers ${reviewers.join(', ') || 'none'}; self-review ${reviewerRule?.prevent_self_review ? 'prevented' : 'allowed'}; ${publishSecrets.total_count ?? 0} static environment secrets; OIDC trusted publishing`,
      ...shared,
      source: 'GitHub REST API: environments/npm-publish, branch policies, and environment secrets',
    },
  ];
}

function parseArgs(args) {
  const options = { root: process.cwd(), write: false, input: null, now: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') options.write = true;
    else if (arg === '--check') options.write = false;
    else if (arg === '--root') options.root = resolve(requiredValue(args, ++index, '--root'));
    else if (arg.startsWith('--root=')) options.root = resolve(arg.slice('--root='.length));
    else if (arg === '--input') options.input = resolve(requiredValue(args, ++index, '--input'));
    else if (arg.startsWith('--input=')) options.input = resolve(arg.slice('--input='.length));
    else if (arg === '--now') options.now = parseNow(requiredValue(args, ++index, '--now'));
    else if (arg.startsWith('--now=')) options.now = parseNow(arg.slice('--now='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseNow(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid --now timestamp: ${value}`);
  return parsed;
}

function getRemoteRepository() {
  const url = execText('git', ['remote', 'get-url', 'origin']);
  const match = /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/.exec(url);
  if (!match?.groups) throw new Error(`Cannot derive GitHub repository from origin: ${url}`);
  return `${match.groups.owner}/${match.groups.repo}`;
}

function ghJson(args) {
  return JSON.parse(execText('gh', args));
}

function execText(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    const status = error?.status ? ` (exit ${error.status})` : '';
    throw new Error(`${command} ${args.join(' ')} failed${status}: ${stderr || error.message}`);
  }
}

function fetchJson(url) {
  const output = execText(process.execPath, [
    '-e',
    `fetch(${JSON.stringify(url)}).then(async response => { if (!response.ok) throw new Error(String(response.status)); process.stdout.write(JSON.stringify(await response.json())); }).catch(error => { console.error(error.message); process.exit(1); });`,
  ]);
  return JSON.parse(output);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}
