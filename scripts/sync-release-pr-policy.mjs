import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { PUBLIC_INSTALL_DOC_PATHS, rewritePublicInstallPolicy } from './check-docs-commands.mjs';
import { releaseChannelForVersion } from './public-surface-policy.mjs';
import { injectRepositoryEvidence, renderRepositoryEvidence } from './repository-evidence-core.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const supportedChannels = new Set(['alpha', 'beta', 'rc', 'stable']);
const evidencePath = 'docs/governance/repository-evidence.json';
const maturityReportPath = 'docs/repo-maturity-report.md';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requireReleasePullRequest(value) {
  if (!value || !Number.isInteger(value.number) || value.number < 1) {
    throw new Error('release pull request number must be a positive integer');
  }
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    throw new Error('release pull request title must be non-empty');
  }
  if (typeof value.url !== 'string' || value.url.trim().length === 0) {
    throw new Error('release pull request URL must be non-empty');
  }
  return value;
}

const releasePolicyCommitHeadline =
  'chore: sync generated files and release policy with release version';
const releasePolicyCommitSignoff =
  'Signed-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>';

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export function buildReleasePrPolicyCommitInput({
  repository,
  branch,
  expectedHeadOid,
  additions = [],
  deletions = [],
}) {
  return {
    branch: {
      repositoryNameWithOwner: requireNonEmptyString(repository, 'repository'),
      branchName: requireNonEmptyString(branch, 'branch'),
    },
    expectedHeadOid: requireNonEmptyString(expectedHeadOid, 'expectedHeadOid'),
    message: {
      headline: releasePolicyCommitHeadline,
      body: releasePolicyCommitSignoff,
    },
    fileChanges: { additions, deletions },
  };
}

function collectTrackedPolicyChanges(repoRoot) {
  const raw = execFileSync('git', ['diff', '--name-status', '-z', 'HEAD', '--'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const fields = raw.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const additions = [];
  const deletions = [];

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    const path = fields[index++];
    if (!status || !path) throw new Error('unable to parse release policy git diff');
    if (status === 'D') {
      deletions.push({ path });
      continue;
    }
    if (status === 'M' || status === 'T') {
      additions.push(path);
      continue;
    }
    throw new Error(`release policy sync produced unsupported tracked change ${status}: ${path}`);
  }
  return { additions, deletions };
}

export async function commitReleasePrPolicySync(repoRoot, options = {}) {
  const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
  const branch = options.branch ?? process.env.RELEASE_PR_BRANCH;
  requireNonEmptyString(repository, 'GITHUB_REPOSITORY');
  requireNonEmptyString(branch, 'RELEASE_PR_BRANCH');
  requireNonEmptyString(process.env.GH_TOKEN, 'GH_TOKEN');

  execFileSync('git', ['diff', '--check'], { cwd: repoRoot, stdio: 'inherit' });
  const changes = collectTrackedPolicyChanges(repoRoot);
  if (changes.additions.length === 0 && changes.deletions.length === 0) {
    return { changed: false, commit: null, verified: null };
  }

  const expectedHeadOid = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const additions = await Promise.all(
    changes.additions.map(async (path) => ({
      path,
      contents: (await readFile(resolve(repoRoot, path))).toString('base64'),
    })),
  );
  const input = buildReleasePrPolicyCommitInput({
    repository,
    branch,
    expectedHeadOid,
    additions,
    deletions: changes.deletions,
  });
  const query = `mutation($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid } }
  }`;
  const result = spawnSync('gh', ['api', 'graphql', '--input', '-'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: JSON.stringify({ query, variables: { input } }),
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`GitHub signed release-policy commit failed with status ${result.status}`);
  }
  const response = JSON.parse(result.stdout);
  if (response.errors?.length) {
    throw new Error(`GitHub signed release-policy commit failed: ${response.errors[0].message}`);
  }
  const commit = response.data?.createCommitOnBranch?.commit?.oid;
  requireNonEmptyString(commit, 'signed release-policy commit oid');
  const verified = execFileSync(
    'gh',
    ['api', `repos/${repository}/commits/${commit}`, '--jq', '.commit.verification.verified'],
    { cwd: repoRoot, encoding: 'utf8', env: process.env },
  ).trim();
  if (verified !== 'true') {
    throw new Error(`GitHub release-policy commit ${commit} is not verified-signed`);
  }
  return { changed: true, commit, verified: true };
}

async function syncRepositoryEvidence(repoRoot, releasePullRequest, proposedVersion) {
  const pullRequest = requireReleasePullRequest(releasePullRequest);
  const snapshotPath = resolve(repoRoot, evidencePath);
  const reportPath = resolve(repoRoot, maturityReportPath);
  const snapshot = await readJson(snapshotPath);
  if (!snapshot.release || typeof snapshot.release !== 'object') {
    throw new Error(`${evidencePath}: release metadata must exist before staging a release`);
  }

  const stagedPullRequest = {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    proposed_version: proposedVersion,
  };
  const current = snapshot.release.active_release_pr;
  const changed = JSON.stringify(current) !== JSON.stringify(stagedPullRequest);
  snapshot.release.active_release_pr = stagedPullRequest;

  const report = await readFile(reportPath, 'utf8');
  const rendered = renderRepositoryEvidence(snapshot);
  const updatedReport = await format(injectRepositoryEvidence(report, rendered), {
    parser: 'markdown',
  });

  if (changed) await writeJson(snapshotPath, snapshot);
  if (updatedReport !== report) await writeFile(reportPath, updatedReport);
  return changed || updatedReport !== report;
}

export async function syncReleasePrPolicy(repoRoot, options = {}) {
  const configPath = resolve(repoRoot, 'release-please-config.json');
  const config = await readJson(configPath);
  const updatedSurfaces = [];
  const updatedInstallDocs = [];

  for (const packagePath of Object.keys(config.packages ?? {}).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const packageJsonPath = resolve(repoRoot, packagePath, 'package.json');
    const inventoryPath = resolve(repoRoot, packagePath, 'public-surface.json');
    const packageJson = await readJson(packageJsonPath);
    const inventory = await readJson(inventoryPath);
    const channel = releaseChannelForVersion(packageJson.version);

    if (!supportedChannels.has(channel)) {
      throw new Error(
        `${packagePath}: unsupported release channel for version ${packageJson.version}`,
      );
    }

    if (inventory.status !== channel) {
      inventory.status = channel;
      await writeJson(inventoryPath, inventory);
      updatedSurfaces.push(`${packagePath}/public-surface.json`);
    }
  }

  const runtimePackage = await readJson(resolve(repoRoot, 'packages/runtime/package.json'));
  const activeVersion = runtimePackage.version;
  if (!releaseChannelForVersion(activeVersion)) {
    throw new Error(`packages/runtime: unsupported release version ${activeVersion}`);
  }

  if (options.syncInstallDocs) {
    const installDocumentPaths = options.installDocumentPaths ?? PUBLIC_INSTALL_DOC_PATHS;
    for (const documentPath of installDocumentPaths) {
      const absolutePath = resolve(repoRoot, documentPath);
      const original = await readFile(absolutePath, 'utf8');
      const rewritten = rewritePublicInstallPolicy(original, activeVersion, documentPath);
      if (rewritten === original) continue;
      await writeFile(absolutePath, rewritten);
      updatedInstallDocs.push(documentPath);
    }
  }

  const updatedEvidence = options.releasePullRequest
    ? await syncRepositoryEvidence(repoRoot, options.releasePullRequest, activeVersion)
    : false;

  let clearedReleaseAs = false;
  if (options.clearReleaseAs && Object.hasOwn(config, 'release-as')) {
    delete config['release-as'];
    await writeJson(configPath, config);
    clearedReleaseAs = true;
  }

  return { updatedSurfaces, updatedInstallDocs, updatedEvidence, clearedReleaseAs };
}

function releasePullRequestFromEnvironment() {
  const raw = process.env.RELEASE_PR_JSON;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!raw) throw new Error('RELEASE_PR_JSON is required for repository evidence synchronization');
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY is required for repository evidence synchronization');
  }
  const pullRequest = JSON.parse(raw);
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: `https://github.com/${repository}/pull/${pullRequest.number}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const commitSigned = process.argv.includes('--commit-signed');
  const syncRepositoryEvidenceRequested = process.argv.includes('--sync-repository-evidence');
  const result = commitSigned
    ? await commitReleasePrPolicySync(process.cwd())
    : await syncReleasePrPolicy(process.cwd(), {
        clearReleaseAs: process.argv.includes('--clear-release-as'),
        syncInstallDocs: process.argv.includes('--sync-install-docs'),
        releasePullRequest: syncRepositoryEvidenceRequested
          ? releasePullRequestFromEnvironment()
          : undefined,
      });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
