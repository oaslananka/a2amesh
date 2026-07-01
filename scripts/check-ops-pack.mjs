#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'deploy/helm/a2amesh/Chart.yaml',
  'deploy/helm/a2amesh/values.yaml',
  'ops/grafana/a2amesh-dashboard.json',
  'ops/prometheus/a2amesh-alerts.yml',
  'ops/otel/collector.yaml',
  'ops/diagnostics/README.md',
  'ops/diagnostics/bundle-manifest.json',
  'docs/operations/deployment.md',
  'docs-site/operations/deployment.md',
  'docs/operations/observability.md',
  'docs-site/operations/observability.md',
];

const errors = [];
const existingFiles = new Set();

for (const file of requiredFiles) {
  try {
    await access(file);
    existingFiles.add(file);
  } catch {
    errors.push(`missing required file: ${file}`);
  }
}

const dashboardPath = 'ops/grafana/a2amesh-dashboard.json';
if (existingFiles.has(dashboardPath)) {
  try {
    const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'));
    if (!Array.isArray(dashboard.panels) || dashboard.panels.length < 4) {
      errors.push('dashboard must include at least four operator panels');
    }
  } catch (error) {
    errors.push(
      `invalid dashboard json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const alertsPath = 'ops/prometheus/a2amesh-alerts.yml';
if (existingFiles.has(alertsPath)) {
  const alerts = await readFile(alertsPath, 'utf8');
  for (const metric of [
    'a2a_runtime_task_failed_total',
    'a2a_runtime_task_duration_ms_bucket',
    'a2a_registry_healthy_agents',
  ]) {
    if (!alerts.includes(metric)) {
      errors.push(`alert pack is missing metric: ${metric}`);
    }
  }
}

const diagnosticsManifestPath = 'ops/diagnostics/bundle-manifest.json';
if (existingFiles.has(diagnosticsManifestPath)) {
  try {
    const manifest = JSON.parse(await readFile(diagnosticsManifestPath, 'utf8'));
    if (!Array.isArray(manifest.requiredFiles) || manifest.requiredFiles.length < 4) {
      errors.push('diagnostic bundle manifest must list required files');
    }
    if (!Array.isArray(manifest.redactionRules) || manifest.redactionRules.length < 3) {
      errors.push('diagnostic bundle manifest must list redaction rules');
    }
  } catch (error) {
    errors.push(
      `invalid diagnostic bundle manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('Ops pack check passed.');
