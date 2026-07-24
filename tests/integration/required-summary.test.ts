import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(
  new URL('../../scripts/check-required-summary.mjs', import.meta.url),
);
const tempRoots: string[] = [];

const externalRequiredContexts = [
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

const externalRequiredWorkflows = [
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

const requiredJobs = [
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

describe.skipIf(process.platform === 'win32')('required CI summary', () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('accepts only a complete set of successful required jobs', async () => {
    const result = await runSummary(results());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All policy-required CI jobs completed successfully.');
  });

  it.each(['failure', 'cancelled', 'skipped', 'timed_out', 'neutral'])(
    'fails closed when a required job concludes %s',
    async (conclusion) => {
      const result = await runSummary(results({ mutation: conclusion }));

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`mutation completed with ${conclusion}; expected success`);
    },
  );

  it('fails closed when a policy-required job is absent', async () => {
    const jobResults = results();
    delete jobResults['consumer-smoke'];

    const result = await runSummary(jobResults);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'consumer-smoke is missing from the required-summary needs graph',
    );
  });

  it('validates the stable context across pull requests and merge queues', async () => {
    const root = await createConfigFixture();
    const result = await runCli(['--check-config', '--root', root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Required-summary configuration validation passed.');
  });

  it('detects needs, ruleset, event, and documentation drift', async () => {
    const root = await createConfigFixture({ drifted: true });
    const result = await runCli(['--check-config', '--root', root]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('merge_group must emit CI / required-summary');
    expect(result.stderr).toContain('consumer-smoke is missing from required-summary needs');
    expect(result.stderr).toContain('ruleset must require CI / required-summary exactly once');
    expect(result.stderr).toContain(
      'CI / compatibility-smoke (ubuntu-latest, node 22.22.3) must be aggregated',
    );
    expect(result.stderr).toContain(
      'required-check policy must document temporary bypass procedures',
    );
    expect(result.stderr).toContain(
      '.github/workflows/security.yml must emit its required contexts for merge_group',
    );
  });
});

type ResultMap = Record<string, { result: string }>;

function results(overrides: Record<string, string> = {}): ResultMap {
  return Object.fromEntries(
    requiredJobs.map((job) => [job, { result: overrides[job] ?? 'success' }]),
  );
}

async function runSummary(jobResults: ResultMap) {
  return runCli([], {
    REQUIRED_JOB_RESULTS: JSON.stringify(jobResults),
  });
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ...env },
      maxBuffer: 2 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof result.code === 'number' ? result.code : 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
}

async function createConfigFixture(options: { drifted?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'a2amesh-required-summary-'));
  tempRoots.push(root);
  const jobs = options.drifted
    ? requiredJobs.filter((job) => job !== 'consumer-smoke')
    : requiredJobs;
  const events = options.drifted ? '  pull_request:\n' : '  pull_request:\n  merge_group:\n';
  const jobStubs = requiredJobs.map((job) => `  ${job}:\n    runs-on: ubuntu-latest\n`).join('');
  const workflow = `name: CI\non:\n${events}jobs:\n${jobStubs}  required-summary:\n    name: CI / required-summary\n    if: \${{ always() }}\n    needs:\n${jobs.map((job) => `      - ${job}\n`).join('')}    runs-on: ubuntu-latest\n    env:\n      REQUIRED_JOB_RESULTS: \${{ toJSON(needs) }}\n    steps:\n      - run: node scripts/check-required-summary.mjs\n`;
  const ruleset = {
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: options.drifted
            ? [
                { context: 'CI / tests-required' },
                { context: 'CI / compatibility-smoke (ubuntu-latest, node 22.22.3)' },
                ...externalRequiredContexts.map((context) => ({ context })),
              ]
            : [
                { context: 'CI / required-summary' },
                { context: 'CI / tests-required' },
                ...externalRequiredContexts.map((context) => ({ context })),
              ],
        },
      },
    ],
  };
  const documentation = options.drifted
    ? '# Required checks\n\n`CI / required-summary`\n'
    : `# Required checks\n\n\`CI / required-summary\` and \`CI / tests-required\` run for pull requests and the merge queue. Required jobs that are not applicable return an explicit successful no-op; unexpectedly skipped jobs fail closed. Temporary bypass procedures require an incident issue and immediate protection restoration.\n\n${externalRequiredContexts.map((context) => `- \`${context}\``).join('\n')}\n`;

  await write(join(root, '.github/workflows/ci.yml'), workflow);
  await write(join(root, '.github/rulesets/main.json'), `${JSON.stringify(ruleset, null, 2)}\n`);
  await write(join(root, 'docs/release/branch-protection.md'), documentation);
  for (const { path, contexts } of externalRequiredWorkflows) {
    const includeMergeGroup = !(options.drifted && path === '.github/workflows/security.yml');
    const eventBlock = includeMergeGroup
      ? "'on':\n  pull_request:\n  merge_group:\n"
      : "'on':\n  pull_request:\n";
    const jobs = contexts
      .map(
        (context, index) => `  job-${index}:\n    name: ${context}\n    runs-on: ubuntu-latest\n`,
      )
      .join('');
    const dependencyNoOp =
      path === '.github/workflows/dependency-review.yml'
        ? '    steps:\n      - if: github.event_name == \'merge_group\'\n        run: echo "Dependency review passed on each constituent pull request."\n'
        : '';
    await write(join(root, path), `name: fixture\n${eventBlock}jobs:\n${jobs}${dependencyNoOp}`);
  }
  return root;
}

async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
