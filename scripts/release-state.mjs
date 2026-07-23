#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareSemanticVersions, evaluateReleaseState } from './release-state-core.mjs';

const options = parseArgs(process.argv.slice(2));
const observation = collectObservation(options);
const evaluation = evaluateReleaseState(observation);

if (options.json) console.log(JSON.stringify(evaluation, null, 2));
else printHumanSummary(evaluation);

if (options.mode === 'release-please' && !evaluation.gates.releasePlease) process.exitCode = 1;
if (options.mode === 'publish' && !evaluation.gates.publish) process.exitCode = 1;

function collectObservation(options) {
  const errors = [];
  const drift = [];
  const repository = process.env.GITHUB_REPOSITORY ?? getRemoteRepository(errors);
  const config = readJsonFile('release-please-config.json', errors);
  const manifest = readJsonFile('.release-please-manifest.json', errors);
  const sourcePackages = [];

  for (const [path, entry] of Object.entries(config?.packages ?? {})) {
    const packageJson = readJsonFile(`${path}/package.json`, errors);
    sourcePackages.push({
      path,
      name: entry?.['package-name'] ?? packageJson?.name ?? path,
      version: manifest?.[path] ?? packageJson?.version ?? null,
    });
    if (packageJson?.version && manifest?.[path] && packageJson.version !== manifest[path]) {
      drift.push(
        `${path}: package version ${packageJson.version} does not match release manifest ${manifest[path]}.`,
      );
    }
  }

  const versions = [...new Set(sourcePackages.map((item) => item.version).filter(Boolean))];
  const version = versions.length === 1 ? versions[0] : null;
  const expectedTag = version ? `@a2amesh/runtime-v${version}` : null;
  if (options.tag && expectedTag && options.tag !== expectedTag) {
    drift.push(`Requested tag ${options.tag} does not match prepared source tag ${expectedTag}.`);
  }

  const checkedOutCommit = runText('git', ['rev-parse', 'HEAD'], errors, 'git HEAD') ?? null;
  const supersession = collectSupersession(
    options.recoveryFile,
    version,
    checkedOutCommit,
    errors,
    drift,
  );
  let tagCommit = null;
  if (expectedTag) {
    try {
      tagCommit = runTextOrThrow('git', ['rev-parse', `${expectedTag}^{commit}`]);
    } catch {
      tagCommit = null;
    }
  }

  const canonicalTag = collectCanonicalTag(
    expectedTag,
    tagCommit,
    checkedOutCommit,
    sourcePackages,
  );
  const releasePrs = collectReleasePrs(repository, config, errors);
  const npmPackages = sourcePackages.map((source) => collectNpmPackage(source, errors));

  return {
    repository,
    checkedOutCommit,
    sourcePackages,
    canonicalTag,
    supersession,
    releasePrs,
    npmPackages,
    errors,
    drift,
  };
}

function collectCanonicalTag(name, commit, checkedOutCommit, sourcePackages) {
  if (!commit) {
    return {
      name,
      commit: null,
      isAncestorOfCheckout: false,
      sourceVersionMatches: false,
    };
  }

  return {
    name,
    commit,
    isAncestorOfCheckout: isAncestorCommit(commit, checkedOutCommit),
    sourceVersionMatches: canonicalTagSourceMatches(commit, sourcePackages),
  };
}

function isAncestorCommit(ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  if (ancestor === descendant) return true;
  try {
    runTextOrThrow('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function canonicalTagSourceMatches(commit, sourcePackages) {
  let historicalManifest;
  try {
    historicalManifest = readJsonAtCommit(commit, '.release-please-manifest.json');
  } catch {
    return false;
  }

  return sourcePackages.every((source) => {
    if (!source.version || historicalManifest?.[source.path] !== source.version) {
      return false;
    }
    try {
      const packageJson = readJsonAtCommit(commit, `${source.path}/package.json`);
      return packageJson?.version === source.version;
    } catch {
      return false;
    }
  });
}

function readJsonAtCommit(commit, path) {
  return JSON.parse(runTextOrThrow('git', ['show', `${commit}:${path}`]));
}

function collectSupersession(path, version, checkedOutCommit, errors, drift) {
  const ledger = readJsonFile(path, errors);
  if (ledger?.schemaVersion !== 1) {
    drift.push(`${path}: schemaVersion must be 1.`);
  }
  if (!Array.isArray(ledger?.supersededReleases)) {
    drift.push(`${path}: supersededReleases must be an array.`);
    return null;
  }

  const seenVersions = new Set();
  let current = null;
  for (const [index, entry] of ledger.supersededReleases.entries()) {
    const label = `${path}: supersededReleases[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      drift.push(`${label} must be an object.`);
      continue;
    }

    validateRecoveryEntryShape(entry, label, drift);
    if (typeof entry.version === 'string') {
      if (seenVersions.has(entry.version)) {
        drift.push(`${path}: duplicate supersession entry for ${entry.version}.`);
      }
      seenVersions.add(entry.version);
      if (entry.version === version) current = entry;
    }

    validateRecoveryEntryHistory(entry, label, checkedOutCommit, drift);
  }

  return current;
}

function validateRecoveryEntryShape(entry, label, drift) {
  const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  if (typeof entry.version !== 'string' || !semverPattern.test(entry.version)) {
    drift.push(`${label}.version must be a valid semantic version.`);
  }
  if (
    typeof entry.successorVersion !== 'string' ||
    !semverPattern.test(entry.successorVersion) ||
    typeof entry.version !== 'string' ||
    !semverPattern.test(entry.version) ||
    compareSemanticVersions(entry.successorVersion, entry.version) <= 0
  ) {
    drift.push(`${label}.successorVersion must be a strictly newer valid semantic version.`);
  }
  if (typeof entry.releaseCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(entry.releaseCommit)) {
    drift.push(`${label}.releaseCommit must be a full 40-character Git commit id.`);
  }
  if (!isValidIsoDate(entry.decisionDate)) {
    drift.push(`${label}.decisionDate must be a valid YYYY-MM-DD date.`);
  }
  if (
    typeof entry.issue !== 'string' ||
    !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(entry.issue)
  ) {
    drift.push(`${label}.issue must be a GitHub issue URL.`);
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
    drift.push(`${label}.reason must contain a non-empty audit rationale.`);
  }
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateRecoveryEntryHistory(entry, label, checkedOutCommit, drift) {
  if (
    typeof entry.releaseCommit !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(entry.releaseCommit) ||
    typeof entry.version !== 'string'
  ) {
    return;
  }

  let resolvedCommit;
  try {
    resolvedCommit = runTextOrThrow('git', ['rev-parse', `${entry.releaseCommit}^{commit}`]);
  } catch {
    drift.push(`${label}.releaseCommit ${entry.releaseCommit} does not resolve to a commit.`);
    return;
  }

  if (checkedOutCommit) {
    try {
      runTextOrThrow('git', ['merge-base', '--is-ancestor', resolvedCommit, checkedOutCommit]);
    } catch {
      drift.push(
        `${label}.releaseCommit ${resolvedCommit} is not an ancestor of checked-out commit ${checkedOutCommit}.`,
      );
    }
  }

  let historicalManifest;
  try {
    const content = runTextOrThrow('git', [
      'show',
      `${resolvedCommit}:.release-please-manifest.json`,
    ]);
    historicalManifest = JSON.parse(content);
  } catch {
    drift.push(`${label}.releaseCommit ${resolvedCommit} has no readable release manifest.`);
    return;
  }

  const historicalVersions =
    historicalManifest &&
    typeof historicalManifest === 'object' &&
    !Array.isArray(historicalManifest)
      ? [...new Set(Object.values(historicalManifest))]
      : [];
  if (historicalVersions.length !== 1 || historicalVersions[0] !== entry.version) {
    drift.push(
      `${label}.releaseCommit ${resolvedCommit} does not prepare linked version ${entry.version}.`,
    );
  }
}

function collectReleasePrs(repository, config, errors) {
  if (!repository) return [];
  let pullRequests;
  try {
    pullRequests = runJsonOrThrow('gh', [
      'pr',
      'list',
      '--repo',
      repository,
      '--state',
      'open',
      '--search',
      'head:release-please--branches--main',
      '--json',
      'number,title,url,headRefName,headRefOid',
    ]);
  } catch (error) {
    errors.push(`GitHub release PR observation failed: ${errorMessage(error)}`);
    return [];
  }

  return pullRequests.map((pr) => {
    try {
      const response = runJsonOrThrow('gh', [
        'api',
        '--method',
        'GET',
        `repos/${repository}/contents/.release-please-manifest.json`,
        '-f',
        `ref=${pr.headRefOid ?? pr.headRefName}`,
      ]);
      const content = Buffer.from(response.content ?? '', 'base64').toString('utf8');
      const prManifest = JSON.parse(content);
      const versions = Object.keys(config?.packages ?? {}).map((path) => prManifest[path]);
      return { number: pr.number, title: pr.title, url: pr.url, versions };
    } catch (error) {
      errors.push(
        `Release Please PR #${pr.number} manifest observation failed: ${errorMessage(error)}`,
      );
      return { number: pr.number, title: pr.title, url: pr.url, versions: [] };
    }
  });
}

function collectNpmPackage(source, errors) {
  let versionExists = false;
  try {
    const observed = runJsonOrThrow('npm', [
      'view',
      `${source.name}@${source.version}`,
      'version',
      '--json',
    ]);
    versionExists = observed === source.version;
  } catch (error) {
    const detail = errorMessage(error);
    if (!/\bE404\b|404 Not Found/i.test(detail)) {
      errors.push(`${source.name}: npm version observation failed: ${detail}`);
    }
  }

  let distTags = {};
  try {
    distTags = runJsonOrThrow('npm', ['view', source.name, 'dist-tags', '--json']) ?? {};
  } catch (error) {
    errors.push(`${source.name}: npm dist-tag observation failed: ${errorMessage(error)}`);
  }

  return { name: source.name, versionExists, distTags };
}

function parseArgs(args) {
  const options = {
    mode: 'report',
    json: false,
    tag: null,
    recoveryFile: '.release-recovery.json',
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--check') options.mode = 'publish';
    else if (arg === '--mode') options.mode = args[++index];
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
    else if (arg === '--tag') options.tag = args[++index];
    else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
    else if (arg === '--recovery-file') options.recoveryFile = args[++index];
    else if (arg.startsWith('--recovery-file=')) {
      options.recoveryFile = arg.slice('--recovery-file='.length);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['report', 'release-please', 'publish'].includes(options.mode)) {
    throw new Error(`Unsupported release-state mode: ${options.mode}`);
  }
  if (!options.recoveryFile) throw new Error('Recovery file path must not be empty.');
  return options;
}

function printHumanSummary(evaluation) {
  console.log(`Release state: ${evaluation.state}`);
  console.log(`Prepared version: ${evaluation.version ?? '<unknown>'}`);
  console.log(`Canonical tag: ${evaluation.expectedTag ?? '<unknown>'}`);
  console.log(`Expected npm dist-tag: ${evaluation.expectedDistTag ?? '<unknown>'}`);
  console.log(
    `Gates: release-please=${evaluation.gates.releasePlease ? 'allow' : 'block'}, publish=${evaluation.gates.publish ? 'allow' : 'block'}`,
  );
  for (const warning of evaluation.warnings) console.log(`Warning: ${warning}`);
  for (const blocker of evaluation.blockers) console.log(`Blocker: ${blocker}`);
  console.log(`Next safe action: ${evaluation.nextSafeAction}`);
}

function readJsonFile(path, errors) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`${path}: ${errorMessage(error)}`);
    return {};
  }
}

function runText(command, args, errors, label) {
  try {
    return runTextOrThrow(command, args);
  } catch (error) {
    errors.push(`${label} observation failed: ${errorMessage(error)}`);
    return null;
  }
}

function runTextOrThrow(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runJsonOrThrow(command, args) {
  const output = runTextOrThrow(command, args);
  return output ? JSON.parse(output) : null;
}

function getRemoteRepository(errors) {
  const url = runText('git', ['remote', 'get-url', 'origin'], errors, 'git remote');
  const match = url?.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/);
  return match?.groups ? `${match.groups.owner}/${match.groups.repo}` : 'oaslananka/a2amesh';
}

function errorMessage(error) {
  if (error && typeof error === 'object') {
    const stderr = 'stderr' in error ? String(error.stderr ?? '').trim() : '';
    if (stderr) return stderr;
    if ('message' in error) return String(error.message);
  }
  return String(error);
}
