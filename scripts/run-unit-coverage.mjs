#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCoverageReport, renderCoverageMarkdown } from './report-coverage.mjs';
import { coveragePolicy } from './coverage-policy.mjs';

const GIT_EXECUTABLE =
  process.platform === 'win32' ? String.raw`C:\Program Files\Git\cmd\git.exe` : '/usr/bin/git';

function readChangedFiles() {
  const base = process.env.COVERAGE_BASE_SHA?.trim();
  const range = base ? `${base}...HEAD` : 'HEAD^...HEAD';
  if (!existsSync(GIT_EXECUTABLE)) return [];
  const diff = spawnSync(GIT_EXECUTABLE, ['diff', '--name-only', range], { encoding: 'utf8' });
  if (diff.status !== 0) return [];
  return diff.stdout.split(/\r?\n/).filter(Boolean);
}

const forwarded = process.argv.slice(2);
if (forwarded.some((argument) => argument.includes('unit.junit.xml'))) {
  mkdirSync('test-results', { recursive: true });
}

const vitestEntry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', '--coverage', ...forwarded],
  { stdio: 'inherit', env: process.env },
);

let reportExit = 0;
if (existsSync('coverage/coverage-summary.json')) {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  const report = buildCoverageReport({
    policy: coveragePolicy,
    summary,
    changedFiles: readChangedFiles(),
  });
  mkdirSync('coverage', { recursive: true });
  writeFileSync('coverage/package-summary.json', `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync('coverage/package-summary.md', renderCoverageMarkdown(report));
  if (report.failures.length > 0) {
    for (const failure of report.failures) console.error(`- ${failure}`);
    reportExit = 1;
  }
} else {
  console.error('Coverage summary was not generated.');
  reportExit = 1;
}

const testExit = result.status ?? 1;
process.exit(testExit !== 0 || reportExit !== 0 ? 1 : 0);
