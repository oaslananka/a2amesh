#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

const packageNames = new Set([
  '@a2amesh/protocol',
  '@a2amesh/runtime',
  '@a2amesh/registry',
  '@a2amesh/mcp',
  '@a2amesh/cli',
  '@a2amesh/create-a2amesh',
]);

function hasPendingMetadata(evaluation) {
  const version = evaluation?.version;
  return (
    evaluation?.state === 'prepared-unpublished' &&
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) &&
    evaluation.expectedTag === '@a2amesh/runtime-v' + version &&
    evaluation.gates?.releasePlease === false &&
    evaluation.gates?.publish === false &&
    evaluation.gates?.retainAssets === false &&
    Array.isArray(evaluation.packages) &&
    evaluation.packages.length === packageNames.size &&
    Array.isArray(evaluation.blockers)
  );
}

function hasAllUnpublishedPackages(packages, version) {
  const seen = new Set();
  for (const pkg of packages) {
    if (!packageNames.has(pkg?.name) || seen.has(pkg.name)) return false;
    if (pkg.version !== version || pkg.versionExists !== false || pkg.complete !== false) {
      return false;
    }
    seen.add(pkg.name);
  }
  return seen.size === packageNames.size;
}

function hasOnlyExpectedBlockers(blockers, version, expectedTag) {
  const missingTag = 'Missing canonical tag ' + expectedTag + ' for checked-out commit ';
  const missingPackages = new Set(packageNames);
  let foundTag = false;
  for (const blocker of blockers) {
    if (typeof blocker !== 'string') return false;
    if (blocker.startsWith(missingTag)) {
      if (foundTag || !/^[0-9a-f]{40}\.$/.test(blocker.slice(missingTag.length))) return false;
      foundTag = true;
      continue;
    }
    const match = /^(@a2amesh\/[a-z0-9-]+)@([0-9A-Za-z.-]+) is missing from npm\.$/.exec(blocker);
    if (!match || match[2] !== version || !missingPackages.delete(match[1])) return false;
  }
  return foundTag && missingPackages.size === 0;
}

export function isSafePendingRelease(evaluation) {
  return (
    hasPendingMetadata(evaluation) &&
    hasAllUnpublishedPackages(evaluation.packages, evaluation.version) &&
    hasOnlyExpectedBlockers(evaluation.blockers, evaluation.version, evaluation.expectedTag)
  );
}

if (process.argv[1]?.endsWith('/check-release-please-pending.mjs')) {
  let evaluation;
  try {
    if (process.argv.length !== 2) throw new Error('unexpected arguments');
    evaluation = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    console.error('Release state observation is missing or invalid; failing closed.');
    process.exit(1);
  }

  if (!isSafePendingRelease(evaluation)) {
    console.error('Release state contains unexpected blockers; manual reconciliation required.');
    process.exit(1);
  }

  const message =
    'Prepared release awaits publication; no additional Release Please PR is needed. ' +
    'The separate protected Publish workflow remains mandatory.';
  console.log('::warning title=Release pending publication::' + message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Release Please\n\n' + message + '\n');
  }
}
