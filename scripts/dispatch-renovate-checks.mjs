#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANONICAL_REPOSITORY = 'oaslananka/a2amesh';
const RENOVATE_BRANCH_PREFIX = 'repository-managed-renovate/';
const RENOVATE_AUTHORS = new Set(['app/github-actions', 'github-actions[bot]']);

const WORKFLOW_CONTEXT_PREFIXES = Object.freeze({
  'ci.yml': 'CI / ',
  'docs.yml': 'Docs / ',
  'security.yml': 'Security / ',
  'codeql.yml': 'CodeQL / ',
  'scorecard.yml': 'Scorecard / ',
  'dependency-review.yml': 'Dependency Review / ',
});

export function groupRequiredContexts(ruleset) {
  const requiredRule = ruleset.rules?.find((rule) => rule.type === 'required_status_checks');
  const contexts =
    requiredRule?.parameters?.required_status_checks?.map(({ context }) => context) ?? [];
  const grouped = Object.fromEntries(
    Object.entries(WORKFLOW_CONTEXT_PREFIXES).map(([workflow, prefix]) => [
      workflow,
      contexts.filter((context) => context.startsWith(prefix)),
    ]),
  );
  const ungrouped = contexts.filter(
    (context) =>
      !Object.values(WORKFLOW_CONTEXT_PREFIXES).some((prefix) => context.startsWith(prefix)),
  );
  if (ungrouped.length > 0) {
    throw new Error(`Required status contexts have no workflow mapping: ${ungrouped.join(', ')}`);
  }
  for (const [workflow, markers] of Object.entries(grouped)) {
    if (markers.length === 0) throw new Error(`No required status contexts found for ${workflow}`);
  }
  return grouped;
}

const ruleset = JSON.parse(
  readFileSync(new URL('../.github/rulesets/main.json', import.meta.url), 'utf8'),
);
export const REQUIRED_WORKFLOW_MARKERS = Object.freeze(
  Object.fromEntries(
    Object.entries(groupRequiredContexts(ruleset)).map(([workflow, markers]) => [
      workflow,
      Object.freeze(markers),
    ]),
  ),
);

export function createDispatchPlan({ pullRequests, checkRunsBySha }) {
  const plan = [];
  for (const pullRequest of pullRequests.filter(isRenovatePullRequest)) {
    const checkNames = checkRunsBySha.get(pullRequest.headRefOid) ?? new Set();
    for (const [workflow, markers] of Object.entries(REQUIRED_WORKFLOW_MARKERS)) {
      if (markers.every((marker) => checkNames.has(marker))) continue;
      plan.push({
        prNumber: pullRequest.number,
        workflow,
        ref: pullRequest.headRefName,
        headSha: pullRequest.headRefOid,
        fields: workflowFields(workflow, pullRequest),
      });
    }
  }
  return plan;
}

function isRenovatePullRequest(pullRequest) {
  return (
    RENOVATE_AUTHORS.has(pullRequest.author?.login) &&
    pullRequest.headRefName?.startsWith(RENOVATE_BRANCH_PREFIX) === true &&
    typeof pullRequest.headRefOid === 'string' &&
    typeof pullRequest.baseRefOid === 'string'
  );
}

function workflowFields(workflow, pullRequest) {
  if (workflow === 'docs.yml') return { deploy: 'false' };
  if (workflow === 'dependency-review.yml') {
    return {
      base_ref: pullRequest.baseRefOid,
      head_ref: pullRequest.headRefOid,
    };
  }
  return {};
}

function resolveGhBinary() {
  const binary = process.env.GH_BIN ?? '/usr/bin/gh';
  if (!isAbsolute(binary)) throw new Error('GH_BIN must be an absolute path');
  return binary;
}

function runGh(args, options = {}) {
  return execFileSync(resolveGhBinary(), args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'inherit'],
  });
}

function runGhJson(args) {
  const output = runGh(args);
  return JSON.parse(output);
}

function listOpenPullRequests(repository) {
  const pullRequests = runGhJson([
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repository}/pulls?state=open&per_page=100`,
  ]);
  return pullRequests.map((pullRequest) => ({
    number: pullRequest.number,
    author: { login: pullRequest.user?.login ?? '' },
    headRefName: pullRequest.head?.ref ?? '',
    headRefOid: pullRequest.head?.sha ?? '',
    baseRefOid: pullRequest.base?.sha ?? '',
  }));
}

function readCheckNames(repository, sha) {
  const response = runGhJson([
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repository}/commits/${sha}/check-runs?per_page=100`,
  ]);
  return new Set((response.check_runs ?? []).map(({ name }) => name).filter(Boolean));
}

function assertStableHead(repository, dispatch) {
  const current = runGhJson([
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    `repos/${repository}/pulls/${dispatch.prNumber}`,
  ]);
  if (current.state !== 'open' || current.head?.sha !== dispatch.headSha) {
    throw new Error(
      `Renovate PR #${dispatch.prNumber} head changed before dispatch; expected ${dispatch.headSha}, found ${current.head?.sha ?? '<missing>'}`,
    );
  }
}

function dispatchWorkflow(repository, dispatch) {
  assertStableHead(repository, dispatch);
  const args = ['workflow', 'run', dispatch.workflow, '--repo', repository, '--ref', dispatch.ref];
  for (const [name, value] of Object.entries(dispatch.fields)) {
    args.push('-f', `${name}=${value}`);
  }
  runGh(args, { capture: false });
  console.log(
    `Dispatched ${dispatch.workflow} for Renovate PR #${dispatch.prNumber} at ${dispatch.headSha}.`,
  );
}

function runCli() {
  const repository = process.env.GITHUB_REPOSITORY ?? CANONICAL_REPOSITORY;
  if (repository !== CANONICAL_REPOSITORY) {
    throw new Error(`Renovate check dispatch is restricted to ${CANONICAL_REPOSITORY}`);
  }
  const pullRequests = listOpenPullRequests(repository).filter(isRenovatePullRequest);
  const checkRunsBySha = new Map(
    pullRequests.map((pullRequest) => [
      pullRequest.headRefOid,
      readCheckNames(repository, pullRequest.headRefOid),
    ]),
  );
  const plan = createDispatchPlan({ pullRequests, checkRunsBySha });
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (plan.length === 0) {
    console.log('No missing required workflow checks for open Renovate pull requests.');
    return;
  }
  for (const dispatch of plan) dispatchWorkflow(repository, dispatch);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
