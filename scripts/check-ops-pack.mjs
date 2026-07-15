#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';

const chartRoot = 'deploy/helm/a2amesh';
const requiredFiles = [
  `${chartRoot}/Chart.yaml`,
  `${chartRoot}/README.md`,
  `${chartRoot}/values.yaml`,
  `${chartRoot}/values.schema.json`,
  `${chartRoot}/values-dev.yaml`,
  `${chartRoot}/values-single-node.yaml`,
  `${chartRoot}/values-production.yaml`,
  `${chartRoot}/ci/values-kind.yaml`,
  `${chartRoot}/templates/_helpers.tpl`,
  `${chartRoot}/templates/000-validate.yaml`,
  `${chartRoot}/templates/serviceaccounts.yaml`,
  `${chartRoot}/templates/registry-secret.yaml`,
  `${chartRoot}/templates/runtime-secret.yaml`,
  `${chartRoot}/templates/registry-configmap.yaml`,
  `${chartRoot}/templates/runtime-configmap.yaml`,
  `${chartRoot}/templates/registry-workload.yaml`,
  `${chartRoot}/templates/runtime-deployment.yaml`,
  `${chartRoot}/templates/services.yaml`,
  `${chartRoot}/templates/ingress.yaml`,
  `${chartRoot}/templates/networkpolicy.yaml`,
  `${chartRoot}/templates/pdb.yaml`,
  `${chartRoot}/templates/hpa.yaml`,
  `${chartRoot}/templates/tests/smoke-test.yaml`,
  `${chartRoot}/templates/NOTES.txt`,
  '.github/workflows/helm.yml',
  'scripts/check-helm-chart.mjs',
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

async function readExisting(path) {
  return existingFiles.has(path) ? readFile(path, 'utf8') : undefined;
}

function readYamlScalar(content, key) {
  const match = new RegExp(`^${key}:\\s*['\"]?([^'\"#\\s]+)`, 'm').exec(content);
  return match?.[1];
}

const manifestPath = '.release-please-manifest.json';
try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const runtimeVersion = manifest['packages/runtime'];
  const registryVersion = manifest['packages/registry'];
  const chart = await readExisting(`${chartRoot}/Chart.yaml`);
  if (runtimeVersion !== registryVersion) {
    errors.push('runtime and registry release manifest versions must match for the combined chart');
  }
  if (chart) {
    const chartVersion = readYamlScalar(chart, 'version');
    const appVersion = readYamlScalar(chart, 'appVersion');
    if (chartVersion !== runtimeVersion) {
      errors.push(`${chartRoot}/Chart.yaml version must match packages/runtime release version`);
    }
    if (appVersion !== runtimeVersion) {
      errors.push(`${chartRoot}/Chart.yaml appVersion must match packages/runtime release version`);
    }
    if (!chart.includes("kubeVersion: '>=1.28.0-0'")) {
      errors.push('Helm chart must declare the supported Kubernetes version floor');
    }
  }
} catch (error) {
  errors.push(
    `invalid release manifest: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const values = await readExisting(`${chartRoot}/values.yaml`);
if (values) {
  const requiredDefaults = [
    'runtime:\n  enabled: false',
    'registry:\n  enabled: true',
    'require: true',
    'type: ClusterIP',
    'automountServiceAccountToken: false',
    'readOnlyRootFilesystem: true',
    'runAsNonRoot: true',
    'allowPrivilegeEscalation: false',
    'networkPolicy:\n  enabled: true',
    'acknowledgeUnauthenticatedEndpoint: false',
  ];
  for (const required of requiredDefaults) {
    if (!values.includes(required)) {
      errors.push(`Helm secure defaults are missing: ${required.replaceAll('\n', ' / ')}`);
    }
  }
  if (values.includes('type: LoadBalancer') || values.includes('enabled: true\n    className:')) {
    errors.push('Helm defaults must not expose LoadBalancer or ingress endpoints');
  }
}

const productionValues = await readExisting(`${chartRoot}/values-production.yaml`);
if (productionValues) {
  for (const required of [
    'existingSecret: a2amesh-registry-auth',
    'existingSecret: a2amesh-provider-secret',
    'backend: sqlite',
    'persistence:\n    enabled: true',
    'digest: sha256:',
  ]) {
    if (!productionValues.includes(required)) {
      errors.push(`production Helm profile is missing: ${required.replaceAll('\n', ' / ')}`);
    }
  }
}

const schemaPath = `${chartRoot}/values.schema.json`;
if (existingFiles.has(schemaPath)) {
  try {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    if (schema.additionalProperties !== false) {
      errors.push('Helm values schema must reject unknown top-level properties');
    }
    if (!schema.properties?.registry || !schema.properties?.runtime) {
      errors.push('Helm values schema must validate registry and runtime values');
    }
  } catch (error) {
    errors.push(
      `invalid Helm values schema: ${error instanceof Error ? error.message : String(error)}`,
    );
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
