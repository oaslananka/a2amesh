import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runPnpm = resolve(repoRoot, 'scripts/run-pnpm.mjs');
const reportJsonPath = resolve(repoRoot, '.artifacts/verification/timings.json');
const reportMarkdownPath = resolve(repoRoot, '.artifacts/verification/timings.md');

const budgets = {
  warm: 30 * 60 * 1000,
  clean: 45 * 60 * 1000,
};

function createStages(clean) {
  return [
    { id: 'lint', script: 'lint' },
    { id: 'build', script: clean ? 'build:clean' : 'build' },
    { id: 'build-manifest', script: 'build:manifest' },
    { id: 'typecheck', script: 'typecheck:no-build' },
    { id: 'coverage', script: 'test:coverage:no-build' },
    { id: 'integration', script: 'test:integration:no-build' },
    { id: 'mutation', script: 'test:mutation' },
    { id: 'package', script: 'pack:dry-run' },
    { id: 'schemas', script: 'schemas:check:no-build' },
    { id: 'docs', script: 'docs:check:no-build' },
    { id: 'security', script: 'security' },
    { id: 'operations', script: 'ops:check' },
    { id: 'structure', script: 'verify:structure' },
    { id: 'garbage-collection', script: 'gc' },
  ];
}

function runScript(script) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [runPnpm, 'run', script], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });

    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      rejectPromise(new Error(`Verification stage ${script} failed with ${reason}.`));
    });
  });
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds % 60).toFixed(1)}s`;
}

function renderMarkdown(report) {
  const lines = [
    '# Verification timing report',
    '',
    `- Mode: ${report.mode}`,
    `- Status: ${report.status}`,
    `- Total: ${formatDuration(report.totalMs)}`,
    `- Budget: ${formatDuration(report.budgetMs)}`,
    `- Within budget: ${report.withinBudget ? 'yes' : 'no'}`,
    '',
    '| Stage | Command | Status | Duration |',
    '| --- | --- | --- | ---: |',
  ];

  for (const stage of report.stages) {
    lines.push(
      `| ${stage.id} | \`pnpm run ${stage.script}\` | ${stage.status} | ${formatDuration(stage.durationMs)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function writeReport(report) {
  await mkdir(dirname(reportJsonPath), { recursive: true });
  const markdown = renderMarkdown(report);
  await Promise.all([
    writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(reportMarkdownPath, markdown),
  ]);

  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath) await appendFile(summaryPath, `\n${markdown}`);
}

const argumentsSet = new Set(process.argv.slice(2));
const clean = argumentsSet.has('--clean');
const planOnly = argumentsSet.has('--plan');
const enforceBudget = argumentsSet.has('--enforce-budget');
const mode = clean ? 'clean' : 'warm';
const stages = createStages(clean);
const budgetMs = budgets[mode];

if (planOnly) {
  process.stdout.write(`${JSON.stringify({ mode, budgetMs, stages })}\n`);
} else {
  const startedAt = new Date();
  const startedClock = performance.now();
  const stageResults = [];
  let status = 'passed';
  let failure;

  for (const stage of stages) {
    const stageStartedAt = new Date();
    const stageStartedClock = performance.now();
    process.stdout.write(`\n=== Verification: ${stage.id} (pnpm run ${stage.script}) ===\n`);
    try {
      await runScript(stage.script);
      stageResults.push({
        ...stage,
        status: 'passed',
        startedAt: stageStartedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - stageStartedClock),
      });
    } catch (error) {
      status = 'failed';
      failure = error;
      stageResults.push({
        ...stage,
        status: 'failed',
        startedAt: stageStartedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - stageStartedClock),
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  const totalMs = Math.round(performance.now() - startedClock);
  const withinBudget = totalMs <= budgetMs;
  if (status === 'passed' && enforceBudget && !withinBudget) {
    status = 'failed';
    failure = new Error(
      `${mode} verification exceeded its ${formatDuration(budgetMs)} budget: ${formatDuration(totalMs)}.`,
    );
  }

  const report = {
    schemaVersion: 1,
    mode,
    status,
    enforceBudget,
    budgetMs,
    withinBudget,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totalMs,
    stages: stageResults,
  };
  await writeReport(report);
  process.stdout.write(`\nVerification ${status} in ${formatDuration(totalMs)}.\n`);
  process.stdout.write(`Timing report: ${reportMarkdownPath}\n`);

  if (failure) throw failure;
}
