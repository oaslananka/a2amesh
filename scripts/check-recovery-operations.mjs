#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));
const failures = [];
const policy = json('ops/recovery/recovery-policy.json');
const recoveryManifest = json('ops/recovery/diagnostic-bundle-manifest.json');
const genericManifest = json('ops/diagnostics/bundle-manifest.json');
const pkg = json('package.json');
const alerts = read('ops/prometheus/a2amesh-alerts.yml');
const alertTests = read('ops/prometheus/a2amesh-alerts.test.yml');
const dashboard = read('ops/grafana/a2amesh-dashboard.json');
const docs = read('docs/operations/recovery.md');
const docsSite = read('docs-site/operations/recovery.md');
const workflow = read('.github/workflows/ci.yml');

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

requireCondition(policy.schemaVersion === 1, 'recovery policy schemaVersion must be 1');
requireCondition(
  policy.supportedTopology === 'hardened-single-node',
  'recovery policy must not claim an unverified HA topology',
);
for (const key of [
  'productionRpoSeconds',
  'productionRtoSeconds',
  'drillRpoSeconds',
  'drillRtoSeconds',
  'staleBackupAfterSeconds',
]) {
  requireCondition(
    Number.isSafeInteger(policy.targets?.[key]) && policy.targets[key] > 0,
    `invalid recovery target: ${key}`,
  );
}
requireCondition(
  policy.storageProtection?.encryptionAtRestRequired === true &&
    policy.storageProtection?.encryptionInTransitRequired === true,
  'independent backup storage must require encryption at rest and in transit',
);
requireCondition(
  Array.isArray(policy.datasets) && policy.datasets.some((entry) => entry.id === 'registry-agents'),
  'recovery policy must inventory registry agents',
);
requireCondition(
  !genericManifest.requiredFiles.includes('recovery-report.json'),
  'generic diagnostic bundles must not require recovery-only evidence',
);
for (const name of ['recovery-report.json', 'recovery-metrics.prom']) {
  requireCondition(
    recoveryManifest.requiredFiles.includes(name),
    `recovery manifest is missing ${name}`,
  );
}
for (const script of ['recovery:test', 'recovery:alerts', 'recovery:drill', 'recovery:check']) {
  requireCondition(typeof pkg.scripts?.[script] === 'string', `package.json is missing ${script}`);
}
for (const metric of [
  'a2a_recovery_backup_integrity_ok',
  'a2a_recovery_backup_last_success_timestamp_seconds',
  'a2a_recovery_restore_last_duration_seconds',
  'a2a_recovery_drill_success',
]) {
  requireCondition(alerts.includes(metric), `alert rules are missing ${metric}`);
  requireCondition(dashboard.includes(metric), `dashboard is missing ${metric}`);
}
for (const alert of [
  'A2AMeshBackupIntegrityFailed',
  'A2AMeshBackupStale',
  'A2AMeshRecoveryRtoExceeded',
  'A2AMeshRecoveryDrillFailed',
]) {
  requireCondition(alertTests.includes(alert), `promtool fixtures are missing ${alert}`);
}
requireCondition(docs === docsSite, 'canonical and docs-site recovery runbooks must match');
requireCondition(
  docs.includes('hardened single-node'),
  'recovery runbook must identify the supported topology',
);
requireCondition(
  docs.includes('not an HA topology'),
  'recovery runbook must state the HA non-goal',
);
requireCondition(workflow.includes('name: CI / recovery'), 'CI workflow must define CI / recovery');
requireCondition(
  workflow.includes('pnpm run recovery:drill'),
  'CI recovery job must execute the disposable drill',
);
requireCondition(
  workflow.includes('.artifacts/recovery/diagnostic-bundle/**'),
  'CI recovery artifact must include the redacted diagnostic bundle',
);

for (const script of [
  'scripts/verify-helm-registry-persistence.sh',
  'scripts/verify-helm-network-boundaries.sh',
]) {
  const result = spawnSync('/usr/bin/bash', ['-n', script], { encoding: 'utf8', timeout: 30_000 });
  requireCondition(result.status === 0, `${script} has invalid Bash syntax: ${result.stderr}`);
}

if (failures.length > 0) {
  console.error('Recovery operations check failed.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Recovery operations check passed.');
