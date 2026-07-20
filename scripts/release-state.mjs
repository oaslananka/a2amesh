#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluateReleaseState } from './release-state-core.mjs';

const options = parseArgs(process.argv.slice(2));
const observation = collectObservation(options);
const evaluation = evaluateReleaseState(observation);

if (options.json) console.log(JSON.stringify(evaluation, null, 2));
else printHumanSummary(evaluation);

if (options.mode === 'release-please' && !evaluation.gates.releasePlease) process.exitCode = 1;
if (options.mode === 'publish' && !evaluation.gates.publish) process.exitCode = 1;

function collectObservation(options) {
  const errors = [];
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
      errors.push(
        `${path}: package version ${packageJson.version} does not match release manifest ${manifest[path]}.`,
      );
    }
  }

  const versions = [...new Set(sourcePackages.map((item) => item.version).filter(Boolean))];
  const version = versions.length === 1 ? versions[0] : null;
  const expectedTag = version ? `@a2amesh/runtime-v${version}` : null;
  if (options.tag && expectedTag && options.tag !== expectedTag) {
    errors.push(`Requested tag ${options.tag} does not match prepared source tag ${expectedTag}.`);
  }

  const checkedOutCommit = runText('git', ['rev-parse', 'HEAD'], errors, 'git HEAD') ?? null;
  let tagCommit = null;
  if (expectedTag) {
    try {
      tagCommit = runTextOrThrow('git', ['rev-parse', `${expectedTag}^{commit}`]);
    } catch {
      tagCommit = null;
    }
  }

  const releasePrs = collectReleasePrs(repository, config, errors);
  const npmPackages = sourcePackages.map((source) => collectNpmPackage(source, errors));

  return {
    repository,
    checkedOutCommit,
    sourcePackages,
    canonicalTag: { name: expectedTag, commit: tagCommit },
    releasePrs,
    npmPackages,
    errors,
  };
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
  const options = { mode: 'report', json: false, tag: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--check') options.mode = 'publish';
    else if (arg === '--mode') options.mode = args[++index];
    else if (arg.startsWith('--mode=')) options.mode = arg.slice('--mode='.length);
    else if (arg === '--tag') options.tag = args[++index];
    else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['report', 'release-please', 'publish'].includes(options.mode)) {
    throw new Error(`Unsupported release-state mode: ${options.mode}`);
  }
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
