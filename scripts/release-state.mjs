#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const checkMode = process.argv.includes('--check');
const repository = process.env.GITHUB_REPOSITORY ?? getRemoteRepository();
const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
const config = JSON.parse(readFileSync('release-please-config.json', 'utf8'));
const packages = Object.entries(config.packages ?? {}).map(([path, entry]) => ({
  path,
  packageName: entry['package-name'],
  component: entry.component,
  manifestVersion: manifest[path],
}));

const openReleasePrs = ghJson([
  'pr',
  'list',
  '--repo',
  repository,
  '--state',
  'open',
  '--search',
  'head:release-please--branches--main',
  '--json',
  'number,title,url,headRefName,updatedAt',
]);
const releases = ghJson([
  'release',
  'list',
  '--repo',
  repository,
  '--limit',
  '30',
  '--json',
  'tagName,isDraft,isPrerelease',
]);
const tags = git(['tag', '--list', '*', '--sort=-creatordate']).split('\n').filter(Boolean);

const missingManifest = packages.filter((item) => !item.manifestVersion);
const draftReleases = releases.filter((release) => release.isDraft);
const releasePrBlockers = openReleasePrs.map(
  (pr) => `Release Please PR still open: #${pr.number} ${pr.title} (${pr.url})`,
);
const multipleReleasePrBlocker =
  openReleasePrs.length > 1
    ? [
        `Multiple Release Please PRs are open (${openReleasePrs.length}); close stale PRs before publishing.`,
      ]
    : [];
const safeToPublish =
  repository === 'oaslananka/a2amesh' &&
  openReleasePrs.length === 0 &&
  missingManifest.length === 0 &&
  draftReleases.length === 0;

const state = {
  repository,
  state: openReleasePrs.length > 0 ? 'release-pr-open' : safeToPublish ? 'complete' : 'blocked',
  safe_to_publish: safeToPublish,
  packages,
  open_release_prs: openReleasePrs,
  draft_releases: draftReleases,
  recent_release_tags: releases.map((release) => release.tagName),
  local_tag_count: tags.length,
  next_safe_command: safeToPublish
    ? 'pnpm run release:dry-run'
    : 'Resolve release-state blockers before publishing.',
  blockers: [
    ...releasePrBlockers,
    ...multipleReleasePrBlocker,
    ...missingManifest.map((item) => `Missing manifest version for ${item.path}`),
    ...draftReleases.map((release) => `Draft release remains: ${release.tagName}`),
    ...(repository === 'oaslananka/a2amesh'
      ? []
      : ['Canonical release repository is oaslananka/a2amesh']),
  ],
};

console.log(JSON.stringify(state, null, 2));

if (checkMode && !state.safe_to_publish) {
  console.error('Release state guardrail failed. Resolve blockers before publishing.');
  process.exit(1);
}

function ghJson(args) {
  try {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error('GitHub CLI request failed. Authenticate with gh auth login or configure a GitHub CLI token before running release:state locally. ' + detail);
  }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function getRemoteRepository() {
  let url;
  try {
    url = git(['remote', 'get-url', 'origin']);
  } catch {
    return 'oaslananka/a2amesh';
  }
  const match = url.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/);
  return match?.groups ? `${match.groups.owner}/${match.groups.repo}` : 'oaslananka/a2amesh';
}
