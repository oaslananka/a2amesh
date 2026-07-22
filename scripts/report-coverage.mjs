#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { coveragePolicy } from './coverage-policy.mjs';

const METRICS = ['statements', 'branches', 'functions', 'lines'];

export function buildCoverageReport({
  policy,
  summary,
  repositoryRoot = process.cwd(),
  changedFiles = [],
}) {
  const packages = new Map(
    Object.keys(policy.packages).map((name) => [
      name,
      createAggregate(name, policy.packages[name]),
    ]),
  );
  const files = new Map();

  for (const [fileName, coverage] of Object.entries(summary)) {
    if (fileName === 'total') continue;
    const relative = normalizeCoveragePath(fileName, repositoryRoot);
    files.set(relative, coverage);
    const packageName = relative.match(/^packages\/([^/]+)\/src\//)?.[1];
    if (!packageName || !packages.has(packageName)) continue;
    addCoverage(packages.get(packageName), coverage);
  }

  const changedPackages = new Set(
    changedFiles
      .map((file) => file.replaceAll('\\', '/').match(/^packages\/([^/]+)\//)?.[1])
      .filter(Boolean),
  );
  const failures = [];
  const packageRows = [];
  for (const [name, aggregate] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const row = { ...finalizeAggregate(aggregate), changed: changedPackages.has(name) };
    packageRows.push(row);
    if (row.files === 0) failures.push(`No coverage files were reported for package: ${name}`);
    compareThresholds(
      `${row.changed ? 'changed package' : 'package'} ${name}`,
      row.metrics,
      row.thresholds,
      failures,
    );
  }

  const criticalRows = [];
  for (const [file, thresholds] of Object.entries(policy.criticalFiles).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const coverage = files.get(file);
    if (!coverage) {
      failures.push(`Critical coverage file missing from report: ${file}`);
      criticalRows.push({ file, thresholds, metrics: null });
      continue;
    }
    const metrics = metricPercentages(coverage);
    compareThresholds(`critical file ${file}`, metrics, thresholds, failures);
    criticalRows.push({ file, thresholds, metrics });
  }

  const aggregate = metricPercentages(summary.total);
  compareThresholds('aggregate', aggregate, policy.aggregate, failures);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    aggregate: { metrics: aggregate, thresholds: policy.aggregate },
    changedPackages: [...changedPackages].sort((left, right) => left.localeCompare(right)),
    packages: packageRows,
    criticalFiles: criticalRows,
    failures,
  };
}

export function renderCoverageMarkdown(report) {
  const lines = [
    '# Package coverage report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Package | Changed | Files | Statements | Branches | Functions | Lines | Floor |',
    '| --- | :---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const row of report.packages) {
    lines.push(
      `| ${row.name} | ${row.changed ? 'yes' : ''} | ${row.files} | ${format(row.metrics.statements)} | ${format(row.metrics.branches)} | ${format(row.metrics.functions)} | ${format(row.metrics.lines)} | ${formatThresholds(row.thresholds)} |`,
    );
  }
  lines.push(
    '',
    `Aggregate: statements ${format(report.aggregate.metrics.statements)}, branches ${format(report.aggregate.metrics.branches)}, functions ${format(report.aggregate.metrics.functions)}, lines ${format(report.aggregate.metrics.lines)}.`,
    '',
    '## Critical files',
    '',
    '| File | Statements | Branches | Functions | Lines | Floor |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  );
  for (const row of report.criticalFiles) {
    const metrics = row.metrics ?? { statements: 0, branches: 0, functions: 0, lines: 0 };
    lines.push(
      `| ${row.file} | ${format(metrics.statements)} | ${format(metrics.branches)} | ${format(metrics.functions)} | ${format(metrics.lines)} | ${formatThresholds(row.thresholds)} |`,
    );
  }
  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of report.failures) lines.push(`- ${failure}`);
  } else {
    lines.push('', 'All coverage floors passed.');
  }
  return `${lines.join('\n')}\n`;
}

function createAggregate(name, entry) {
  return {
    name,
    root: entry.root,
    thresholds: entry.thresholds,
    files: 0,
    statements: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  };
}

function addCoverage(aggregate, coverage) {
  aggregate.files += 1;
  for (const metric of METRICS) {
    aggregate[metric].covered += coverage[metric].covered;
    aggregate[metric].total += coverage[metric].total;
  }
}

function finalizeAggregate(aggregate) {
  return {
    name: aggregate.name,
    root: aggregate.root,
    files: aggregate.files,
    thresholds: aggregate.thresholds,
    metrics: Object.fromEntries(
      METRICS.map((metric) => [
        metric,
        percentage(aggregate[metric].covered, aggregate[metric].total),
      ]),
    ),
  };
}

function metricPercentages(coverage) {
  return Object.fromEntries(
    METRICS.map((metric) => [metric, percentage(coverage[metric].covered, coverage[metric].total)]),
  );
}

function percentage(covered, total) {
  return total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
}

function compareThresholds(label, metrics, thresholds, failures) {
  for (const metric of METRICS) {
    if (metrics[metric] < thresholds[metric]) {
      failures.push(
        `${label} ${metric} coverage ${format(metrics[metric])} is below ${format(thresholds[metric])}`,
      );
    }
  }
}

function normalizeCoveragePath(fileName, repositoryRoot) {
  const normalized = fileName.replaceAll('\\', '/');
  const root = path.resolve(repositoryRoot).replaceAll('\\', '/');
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  const packageIndex = normalized.indexOf('/packages/');
  if (packageIndex >= 0) return normalized.slice(packageIndex + 1);
  return normalized.replace(/^\.\//, '');
}

function format(value) {
  return `${Number(value).toFixed(2)}%`;
}

function formatThresholds(thresholds) {
  return `S${thresholds.statements}/B${thresholds.branches}/F${thresholds.functions}/L${thresholds.lines}`;
}

function runCli() {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  const report = buildCoverageReport({ policy: coveragePolicy, summary });
  mkdirSync('coverage', { recursive: true });
  writeFileSync('coverage/package-summary.json', `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync('coverage/package-summary.md', renderCoverageMarkdown(report));
  console.log(
    `Package coverage report written for ${report.packages.length} packages and ${report.criticalFiles.length} critical files.`,
  );
  if (report.failures.length > 0) {
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
