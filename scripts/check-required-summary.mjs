#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUMMARY_CONTEXT = 'CI / required-summary';
const TEST_EVIDENCE_CONTEXT = 'CI / tests-required';
const EXTERNAL_REQUIRED_CONTEXTS = [
  'Docs / build',
  'Docs / links',
  'Docs / command-parity',
  'Security / gitleaks',
  'Security / audit',
  'Security / osv',
  'Security / zizmor',
  'Security / actionlint',
  'Security / semgrep',
  'Security / dependency-license',
  'Dependency Review / review',
  'CodeQL / analyze',
  'Scorecard / scan',
];
const REQUIRED_CONTEXTS = [SUMMARY_CONTEXT, TEST_EVIDENCE_CONTEXT, ...EXTERNAL_REQUIRED_CONTEXTS];
const EXTERNAL_REQUIRED_WORKFLOWS = [
  {
    path: '.github/workflows/docs.yml',
    contexts: ['Docs / build', 'Docs / links', 'Docs / command-parity'],
  },
  {
    path: '.github/workflows/security.yml',
    contexts: [
      'Security / gitleaks',
      'Security / audit',
      'Security / osv',
      'Security / zizmor',
      'Security / actionlint',
      'Security / semgrep',
      'Security / dependency-license',
    ],
  },
  { path: '.github/workflows/dependency-review.yml', contexts: ['Dependency Review / review'] },
  { path: '.github/workflows/codeql.yml', contexts: ['CodeQL / analyze'] },
  { path: '.github/workflows/scorecard.yml', contexts: ['Scorecard / scan'] },
];
const REQUIRED_JOBS = [
  'identity',
  'install',
  'lint',
  'typecheck',
  'unit',
  'integration',
  'performance-smoke',
  'conformance',
  'schemas',
  'api-surfaces',
  'mutation',
  'ui-e2e',
  'build',
  'package-dry-run',
  'workspace-graph',
  'public-surface',
  'command-surface',
  'no-generated-artifacts',
  'gc',
  'compatibility-smoke',
  'consumer-smoke',
  'test-evidence',
];

const options = parseArgs(process.argv.slice(2));
const failures = options.checkConfig
  ? validateConfiguration(options.root)
  : validateRequiredJobResults(process.env.REQUIRED_JOB_RESULTS);

if (failures.length > 0) {
  console.error(
    options.checkConfig
      ? 'Required-summary configuration validation failed.'
      : 'Required CI summary failed.',
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    options.checkConfig
      ? 'Required-summary configuration validation passed.'
      : 'All policy-required CI jobs completed successfully.',
  );
}

function validateRequiredJobResults(rawResults) {
  const failures = [];
  let results;
  try {
    results = JSON.parse(rawResults ?? '');
  } catch {
    return ['REQUIRED_JOB_RESULTS must contain the GitHub Actions needs context as JSON'];
  }
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    return ['REQUIRED_JOB_RESULTS must be a JSON object'];
  }

  for (const job of REQUIRED_JOBS) {
    if (!Object.hasOwn(results, job)) {
      failures.push(`${job} is missing from the required-summary needs graph`);
      continue;
    }
    const result = results[job]?.result;
    if (result !== 'success') {
      failures.push(`${job} completed with ${String(result)}; expected success`);
    }
  }
  return failures;
}

function validateConfiguration(root) {
  const workflow = readText(root, '.github/workflows/ci.yml');
  const ruleset = readJson(root, '.github/rulesets/main.json');
  const documentation = readText(root, 'docs/release/branch-protection.md');
  return [
    ...validateWorkflowEvents(workflow),
    ...validateSummaryJob(workflow),
    ...validateWorkflowJobInventory(workflow),
    ...validateRuleset(ruleset),
    ...validateExternalWorkflows(root),
    ...validateDocumentation(documentation),
  ];
}

function validateWorkflowEvents(workflow) {
  const failures = [];
  if (!/^ {2}pull_request:\s*$/m.test(workflow)) {
    failures.push(`pull_request must emit ${SUMMARY_CONTEXT}`);
  }
  if (!/^ {2}merge_group:\s*$/m.test(workflow)) {
    failures.push(`merge_group must emit ${SUMMARY_CONTEXT}`);
  }
  return failures;
}

function validateSummaryJob(workflow) {
  const failures = [];
  const jobBlock = extractJobBlock(workflow, 'required-summary');
  if (!jobBlock) return [`workflow must define ${SUMMARY_CONTEXT}`];

  if (!jobBlock.includes(`name: ${SUMMARY_CONTEXT}`)) {
    failures.push(`required-summary job name must remain ${SUMMARY_CONTEXT}`);
  }
  if (!jobBlock.includes('if: ${{ always() }}')) {
    failures.push('required-summary must run with always()');
  }
  if (!jobBlock.includes('REQUIRED_JOB_RESULTS: ${{ toJSON(needs) }}')) {
    failures.push('required-summary must pass the complete needs context to its validator');
  }
  if (!jobBlock.includes('run: node scripts/check-required-summary.mjs')) {
    failures.push('required-summary must run the fail-closed validator');
  }
  compareNeeds(extractNeeds(jobBlock), failures);
  return failures;
}

function validateWorkflowJobInventory(workflow) {
  const workflowJobs = extractWorkflowJobs(workflow);
  return REQUIRED_JOBS.filter((job) => !workflowJobs.has(job)).map(
    (job) => `${job} is missing from the CI workflow`,
  );
}

function validateRuleset(ruleset) {
  const failures = [];
  const contexts = requiredContexts(ruleset, failures);
  if (contexts.filter((context) => context === SUMMARY_CONTEXT).length !== 1) {
    failures.push(`ruleset must require ${SUMMARY_CONTEXT} exactly once`);
  }
  if (contexts.filter((context) => context === TEST_EVIDENCE_CONTEXT).length !== 1) {
    failures.push(`ruleset must require ${TEST_EVIDENCE_CONTEXT} exactly once`);
  }
  for (const context of contexts) {
    if (
      context.startsWith('CI / ') &&
      context !== SUMMARY_CONTEXT &&
      context !== TEST_EVIDENCE_CONTEXT
    ) {
      failures.push(`${context} must be aggregated by ${SUMMARY_CONTEXT}, not required directly`);
    }
  }
  const missing = REQUIRED_CONTEXTS.filter((context) => !contexts.includes(context));
  const extra = contexts.filter((context) => !REQUIRED_CONTEXTS.includes(context));
  if (missing.length > 0)
    failures.push(`ruleset required contexts are missing: ${missing.join(', ')}`);
  if (extra.length > 0)
    failures.push(`ruleset contains unexpected required contexts: ${extra.join(', ')}`);
  if (JSON.stringify(contexts) !== JSON.stringify(REQUIRED_CONTEXTS)) {
    failures.push('ruleset required contexts must match the policy order exactly');
  }
  return [...new Set(failures)];
}

function validateExternalWorkflows(root) {
  const failures = [];
  for (const { path, contexts } of EXTERNAL_REQUIRED_WORKFLOWS) {
    const workflow = readText(root, path);
    if (!/^ {2}merge_group:\s*$/m.test(workflow)) {
      failures.push(`${path} must emit its required contexts for merge_group`);
    }
    for (const context of contexts) {
      if (!workflow.includes(`name: ${context}`)) {
        failures.push(`${path} must emit required context ${context}`);
      }
    }
  }

  const dependencyReview = readText(root, '.github/workflows/dependency-review.yml');
  if (!dependencyReview.includes("if: github.event_name == 'merge_group'")) {
    failures.push('dependency review must expose an explicit merge_group no-op');
  }
  if (!dependencyReview.includes('constituent pull request')) {
    failures.push(
      'dependency review merge_group no-op must document constituent pull-request review',
    );
  }
  return failures;
}

function validateDocumentation(documentation) {
  const requiredDocumentation = [
    [SUMMARY_CONTEXT, `required-check policy must document ${SUMMARY_CONTEXT}`],
    [TEST_EVIDENCE_CONTEXT, `required-check policy must document ${TEST_EVIDENCE_CONTEXT}`],
    ['merge queue', 'required-check policy must document merge queue behavior'],
    [
      'explicit successful no-op',
      'required-check policy must document path-conditional no-op behavior',
    ],
    ['unexpectedly skipped', 'required-check policy must document skipped-job handling'],
    ['temporary bypass', 'required-check policy must document temporary bypass procedures'],
  ];
  for (const context of EXTERNAL_REQUIRED_CONTEXTS) {
    requiredDocumentation.push([
      context,
      `required-check policy must document external context ${context}`,
    ]);
  }
  return requiredDocumentation
    .filter(([phrase]) => !documentation.toLowerCase().includes(phrase.toLowerCase()))
    .map(([, message]) => message);
}

function compareNeeds(actualNeeds, failures) {
  for (const job of REQUIRED_JOBS) {
    if (!actualNeeds.includes(job)) failures.push(`${job} is missing from required-summary needs`);
  }
  for (const job of actualNeeds) {
    if (!REQUIRED_JOBS.includes(job))
      failures.push(`${job} is not part of required-summary policy`);
  }
  if (JSON.stringify(actualNeeds) !== JSON.stringify(REQUIRED_JOBS)) {
    failures.push('required-summary needs must match the policy order exactly');
  }
}

function extractJobBlock(workflow, jobId) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${jobId}:`);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function extractNeeds(jobBlock) {
  const lines = jobBlock.split('\n');
  const start = lines.indexOf('    needs:');
  if (start === -1) return [];
  const needs = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^ {6}- ([A-Za-z0-9_-]+)\s*$/.exec(lines[index]);
    if (match) {
      needs.push(match[1]);
      continue;
    }
    if (/^ {4}[A-Za-z0-9_-]+:/.test(lines[index])) break;
  }
  return needs;
}

function extractWorkflowJobs(workflow) {
  const jobsIndex = workflow.indexOf('\njobs:\n');
  const jobsText = jobsIndex === -1 ? '' : workflow.slice(jobsIndex + '\njobs:\n'.length);
  return new Set([...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]));
}

function requiredContexts(ruleset, failures) {
  const rule = ruleset?.rules?.find((candidate) => candidate?.type === 'required_status_checks');
  const entries = rule?.parameters?.required_status_checks;
  if (!Array.isArray(entries)) {
    failures.push('ruleset required_status_checks must be an array');
    return [];
  }
  return entries.map((entry) => entry?.context).filter((context) => typeof context === 'string');
}

function parseArgs(args) {
  const options = { checkConfig: false, root: process.cwd() };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check-config') options.checkConfig = true;
    else if (argument === '--root') options.root = resolve(requiredValue(args, ++index, '--root'));
    else if (argument.startsWith('--root='))
      options.root = resolve(argument.slice('--root='.length));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function readText(root, path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}
