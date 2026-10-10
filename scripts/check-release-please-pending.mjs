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

export function isSafePendingRelease(evaluation) {
  const version = evaluation?.version;
  if (
    evaluation?.state !== 'prepared-unpublished' ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
    evaluation.expectedTag !== '@a2amesh/runtime-v' + version ||
    evaluation.gates?.releasePlease !== false ||
    evaluation.gates?.retainAssets !== false ||
    !Array.isArray(evaluation.packages) ||
    evaluation.packages.length !== packageNames.size ||
    !Array.isArray(evaluation.blockers) ||
    evaluation.blockers.length === 0
  ) {
    return false;
  }

  const seen = new Set();
  for (const pkg of evaluation.packages) {
    if (
      !packageNames.has(pkg?.name) ||
      seen.has(pkg.name) ||
      pkg.version !== version ||
      pkg.versionExists !== false ||
      pkg.complete !== false
    ) {
      return false;
    }
    seen.add(pkg.name);
  }

  const missingTag = 'Missing canonical tag ' + evaluation.expectedTag + ' for checked-out commit ';
  for (const blocker of evaluation.blockers) {
    if (typeof blocker !== 'string') return false;
    if (
      blocker.startsWith(missingTag) &&
      /^[0-9a-f]{40}\.$/.test(blocker.slice(missingTag.length))
    ) {
      continue;
    }
    const missingPackage = /^(@a2amesh\/[a-z0-9-]+)@([0-9A-Za-z.-]+) is missing from npm\.$/.exec(
      blocker,
    );
    if (!missingPackage || !packageNames.has(missingPackage[1]) || missingPackage[2] !== version) {
      return false;
    }
  }
  return true;
}

if (process.argv[1]?.endsWith('/check-release-please-pending.mjs')) {
  let evaluation;
  try {
    const path = process.argv[2];
    if (!path) throw new Error('missing report path');
    evaluation = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error('Release state observation is missing or invalid; failing closed.');
    process.exit(1);
  }

  if (!isSafePendingRelease(evaluation)) {
    console.error('Release state contains unexpected blockers; manual reconciliation required.');
    process.exit(1);
  }

  const message =
    'Release ' +
    evaluation.version +
    ' is prepared but not published; skip creating a further Release Please PR. ' +
    'The separate protected Publish workflow remains mandatory.';
  console.log('::warning title=Release pending publication::' + message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Release Please\n\n' + message + '\n');
  }
}
