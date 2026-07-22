#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const START_MARKER = '<!-- security-support:start -->';
const END_MARKER = '<!-- security-support:end -->';
const ROOT_POLICY = 'SECURITY.md';
const GITHUB_POLICY = '.github/SECURITY.md';

export function extractLinkedVersion(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Release manifest must be an object.');
  }

  const versions = [...new Set(Object.values(manifest))];
  if (
    versions.length !== 1 ||
    typeof versions[0] !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(versions[0])
  ) {
    throw new Error('Security support policy requires exactly one linked version.');
  }
  return versions[0];
}

export function renderSupportBlock(version) {
  const prerelease = version.includes('-') ? version.split('-', 2)[1]?.split('.', 1)[0] : null;
  const distTag = prerelease ?? 'latest';
  const releaseDescription = prerelease
    ? `Current linked ${prerelease} release. Security fixes ship in a new linked release.`
    : 'Current stable release. Security fixes ship in a supported patch or minor release.';

  const rows = [
    ['Installable release line', 'Status', 'Maintenance policy'],
    [`\`${version}\` (\`${distTag}\` dist-tag)`, 'Supported', releaseDescription],
    [
      'Earlier prereleases',
      'Unsupported',
      'Upgrade to the current linked release; routine backports are not provided.',
    ],
    [
      'Unreleased `main` revisions and source snapshots',
      'Best effort',
      'Development revisions are not installable supported releases.',
    ],
  ];
  return renderMarkdownTable(rows);
}

function renderMarkdownTable(rows) {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0), 3),
  );
  const formatRow = (row) =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [formatRow(rows[0]), separator, ...rows.slice(1).map(formatRow)].join('\n');
}

export function syncPolicyText(policy, version) {
  const start = policy.indexOf(START_MARKER);
  const end = policy.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Security policy support markers are missing or out of order.');
  }
  if (policy.indexOf(START_MARKER, start + START_MARKER.length) !== -1) {
    throw new Error('Security policy contains duplicate start markers.');
  }
  if (policy.indexOf(END_MARKER, end + END_MARKER.length) !== -1) {
    throw new Error('Security policy contains duplicate end markers.');
  }

  const before = policy.slice(0, start + START_MARKER.length);
  const after = policy.slice(end);
  return `${before}\n\n${renderSupportBlock(version)}\n\n${after}`;
}

export function validatePolicyFiles({ version, rootPolicy, githubPolicy }) {
  const failures = [];
  if (syncPolicyText(rootPolicy, version) !== rootPolicy) {
    failures.push('SECURITY.md support fragment is out of date.');
  }
  if (syncPolicyText(githubPolicy, version) !== githubPolicy) {
    failures.push('.github/SECURITY.md support fragment is out of date.');
  }
  if (rootPolicy !== githubPolicy) {
    failures.push('Root and .github security policy copies must match.');
  }
  return failures;
}

function runCli() {
  const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'));
  const version = extractLinkedVersion(manifest);
  const rootPolicy = readFileSync(ROOT_POLICY, 'utf8');
  const githubPolicy = readFileSync(GITHUB_POLICY, 'utf8');
  const checkOnly = process.argv.slice(2).includes('--check');

  if (checkOnly) {
    const failures = validatePolicyFiles({ version, rootPolicy, githubPolicy });
    if (failures.length > 0) {
      console.error('Security support policy validation failed.');
      for (const failure of failures) console.error(`- ${failure}`);
      process.exit(1);
    }
    console.log(`Security support policy matches linked release ${version}.`);
    return;
  }

  const updatedRoot = syncPolicyText(rootPolicy, version);
  writeFileSync(ROOT_POLICY, updatedRoot);
  writeFileSync(GITHUB_POLICY, updatedRoot);
  console.log(`Security support policy synchronized to linked release ${version}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
