#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { SqliteFleetStorage } from '../packages/fleet-server/dist/storage/SqliteFleetStorage.js';
import { SqliteAgentStorage } from '../packages/registry/dist/storage/SqliteAgentStorage.js';
import { SqliteTrustLogStorage } from '../packages/registry/dist/storage/SqliteTrustLogStorage.js';
import { SqliteTaskStorage } from '../packages/runtime/dist/storage/SqliteTaskStorage.js';
import { createDiagnosticBundle, validateDiagnosticBundle } from './recovery/diagnostic-bundle.mjs';
import { backupSqliteDatabase, restoreSqliteBackup } from './recovery/sqlite-backup.mjs';

function argumentValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
  return value;
}

function agent(id) {
  return {
    id,
    url: `https://${id}.example.com`,
    card: {
      protocolVersion: '1.0',
      name: `${id} Agent`,
      description: 'Disposable recovery drill agent',
      url: `https://${id}.example.com`,
      version: '1.0.0',
      skills: [],
    },
    status: 'healthy',
    tags: ['recovery'],
    skills: [],
    tenantId: 'tenant-recovery',
    registeredAt: '2026-07-27T12:00:00.000Z',
  };
}

function task(id) {
  return {
    kind: 'task',
    id,
    contextId: 'recovery-context',
    status: { state: 'COMPLETED', timestamp: '2026-07-27T12:00:00.000Z' },
    history: [],
    artifacts: [],
    metadata: { tenantId: 'tenant-recovery' },
    extensions: [],
  };
}

function run(id) {
  return {
    id,
    taskId: 'task-before-backup',
    workerId: 'worker-recovery',
    status: 'COMPLETED',
    approvalState: 'NOT_REQUIRED',
    routingDecision: {
      taskId: 'task-before-backup',
      selectedWorkerId: 'worker-recovery',
      candidateWorkerIds: ['worker-recovery'],
      signals: ['capability'],
      policy: { strategy: { type: 'CAPABILITY_MATCH' }, requiredSignals: ['capability'] },
      reason: 'selected',
      decidedAt: '2026-07-27T12:00:00.000Z',
    },
    artifacts: [],
    tenantId: 'tenant-recovery',
    createdAt: '2026-07-27T12:00:00.000Z',
    updatedAt: '2026-07-27T12:00:00.000Z',
  };
}

function prometheusMetrics(report) {
  const lines = [
    '# HELP a2a_recovery_backup_last_success_timestamp_seconds Unix timestamp of the last verified SQLite backup.',
    '# TYPE a2a_recovery_backup_last_success_timestamp_seconds gauge',
    '# HELP a2a_recovery_backup_integrity_ok Whether the latest SQLite backup passed hash and quick-check validation.',
    '# TYPE a2a_recovery_backup_integrity_ok gauge',
    '# HELP a2a_recovery_restore_last_duration_seconds Duration of the latest verified restore.',
    '# TYPE a2a_recovery_restore_last_duration_seconds gauge',
    '# HELP a2a_recovery_restore_last_success_timestamp_seconds Unix timestamp of the latest verified restore.',
    '# TYPE a2a_recovery_restore_last_success_timestamp_seconds gauge',
  ];
  for (const dataset of report.datasets) {
    lines.push(
      `a2a_recovery_backup_last_success_timestamp_seconds{dataset="${dataset.id}"} ${dataset.backupTimestampSeconds}`,
      `a2a_recovery_backup_integrity_ok{dataset="${dataset.id}"} 1`,
      `a2a_recovery_restore_last_duration_seconds{dataset="${dataset.id}"} ${dataset.restoreDurationSeconds.toFixed(6)}`,
      `a2a_recovery_restore_last_success_timestamp_seconds{dataset="${dataset.id}"} ${report.completedTimestampSeconds}`,
    );
  }
  lines.push(
    '# HELP a2a_recovery_drill_rpo_seconds Measured data-loss window in the disposable recovery drill.',
    '# TYPE a2a_recovery_drill_rpo_seconds gauge',
    `a2a_recovery_drill_rpo_seconds ${report.measuredRpoSeconds.toFixed(6)}`,
    '# HELP a2a_recovery_drill_rto_seconds Measured end-to-end restore time in the disposable recovery drill.',
    '# TYPE a2a_recovery_drill_rto_seconds gauge',
    `a2a_recovery_drill_rto_seconds ${report.measuredRtoSeconds.toFixed(6)}`,
    '# HELP a2a_recovery_drill_success Whether the last disposable recovery drill passed.',
    '# TYPE a2a_recovery_drill_success gauge',
    'a2a_recovery_drill_success 1',
  );
  return `${lines.join('\n')}\n`;
}

function gitCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function runRecoveryDrill(argv = process.argv.slice(2)) {
  const outputDirectory = resolve(argumentValue(argv, '--output', '.artifacts/recovery'));
  const policyPath = resolve(argumentValue(argv, '--policy', 'ops/recovery/recovery-policy.json'));
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  const sourceDirectory = join(outputDirectory, 'source');
  const backupDirectory = join(outputDirectory, 'backups');
  const restoreDirectory = join(outputDirectory, 'restored');
  const diagnosticSource = join(outputDirectory, 'diagnostic-source');
  const bundleDirectory = join(outputDirectory, 'diagnostic-bundle');
  await Promise.all(
    [sourceDirectory, backupDirectory, restoreDirectory, diagnosticSource].map((directory) =>
      mkdir(directory, { recursive: true, mode: 0o700 }),
    ),
  );

  const definitions = [
    { id: 'registry-agents', file: 'registry.sqlite' },
    { id: 'registry-trust-log', file: 'trust-log.sqlite' },
    { id: 'runtime-tasks', file: 'tasks.sqlite' },
    { id: 'fleet-state', file: 'fleet.sqlite' },
  ];
  const sourcePaths = Object.fromEntries(
    definitions.map((definition) => [definition.id, join(sourceDirectory, definition.file)]),
  );

  const registry = new SqliteAgentStorage(sourcePaths['registry-agents']);
  const trust = new SqliteTrustLogStorage(sourcePaths['registry-trust-log']);
  const tasks = new SqliteTaskStorage(sourcePaths['runtime-tasks']);
  const fleet = new SqliteFleetStorage(sourcePaths['fleet-state']);
  await registry.upsert(agent('agent-before-backup'));
  await trust.append({
    cardHash: 'card-before-backup',
    keyId: 'key-recovery',
    algorithm: 'ES256',
    agentUrl: 'https://agent-before-backup.example.com',
    timestamp: '2026-07-27T12:00:00.000Z',
    tenantId: 'tenant-recovery',
  });
  tasks.insertTask(task('task-before-backup'));
  await fleet.createRun(run('run-before-backup'));
  await fleet.appendAudit({
    timestamp: '2026-07-27T12:00:00.000Z',
    action: 'task-routed',
    runId: 'run-before-backup',
    tenantId: 'tenant-recovery',
  });

  const backupStarted = performance.now();
  const backupResults = [];
  for (const definition of definitions) {
    const started = performance.now();
    const result = await backupSqliteDatabase({
      dataset: definition.id,
      sourcePath: sourcePaths[definition.id],
      outputDirectory: backupDirectory,
      keepCount: policy.retention.verifiedBackupSets,
    });
    backupResults.push({
      ...definition,
      ...result,
      durationSeconds: (performance.now() - started) / 1000,
    });
  }
  const backupCompleted = new Date();

  await registry.upsert(agent('agent-after-backup'));
  await trust.append({
    cardHash: 'card-after-backup',
    keyId: 'key-recovery',
    algorithm: 'ES256',
    agentUrl: 'https://agent-after-backup.example.com',
    timestamp: '2026-07-27T12:01:00.000Z',
    tenantId: 'tenant-recovery',
  });
  tasks.insertTask(task('task-after-backup'));
  await fleet.createRun(run('run-after-backup'));
  const failureInjectedAt = new Date();
  registry.close();
  trust.close();
  tasks.close();
  fleet.close();

  const restoreStarted = performance.now();
  const datasetReports = [];
  for (const result of backupResults) {
    const targetPath = join(restoreDirectory, result.file);
    const started = performance.now();
    const restored = await restoreSqliteBackup({
      manifestPath: result.manifestPath,
      targetPath,
    });
    datasetReports.push({
      id: result.id,
      backupFile: basename(result.backupPath),
      manifestFile: basename(result.manifestPath),
      sourceFile: result.file,
      backupDurationSeconds: result.durationSeconds,
      restoreDurationSeconds: (performance.now() - started) / 1000,
      backupTimestampSeconds: Math.floor(Date.parse(result.manifest.createdAt) / 1000),
      quickCheck: restored.quickCheck,
      sha256: result.manifest.sha256,
      sizeBytes: result.manifest.sizeBytes,
    });
  }

  const restoredRegistry = new SqliteAgentStorage(join(restoreDirectory, 'registry.sqlite'));
  const restoredTrust = new SqliteTrustLogStorage(join(restoreDirectory, 'trust-log.sqlite'));
  const restoredTasks = new SqliteTaskStorage(join(restoreDirectory, 'tasks.sqlite'));
  const restoredFleet = new SqliteFleetStorage(join(restoreDirectory, 'fleet.sqlite'));
  const assertions = {
    registryOriginalPresent: Boolean(await restoredRegistry.get('agent-before-backup')),
    registryPostBackupAbsent: (await restoredRegistry.get('agent-after-backup')) === null,
    trustLogLength: (await restoredTrust.list()).length,
    trustLogHead: (await restoredTrust.list())[0]?.cardHash,
    taskOriginalPresent: Boolean(restoredTasks.getTask('task-before-backup')),
    taskPostBackupAbsent: restoredTasks.getTask('task-after-backup') === undefined,
    fleetOriginalPresent: Boolean(await restoredFleet.getRun('run-before-backup')),
    fleetPostBackupAbsent: (await restoredFleet.getRun('run-after-backup')) === null,
    fleetAuditLength: (await restoredFleet.listAudit()).length,
  };
  restoredRegistry.close();
  restoredTrust.close();
  restoredTasks.close();
  restoredFleet.close();

  if (
    !assertions.registryOriginalPresent ||
    !assertions.registryPostBackupAbsent ||
    assertions.trustLogLength !== 1 ||
    assertions.trustLogHead !== 'card-before-backup' ||
    !assertions.taskOriginalPresent ||
    !assertions.taskPostBackupAbsent ||
    !assertions.fleetOriginalPresent ||
    !assertions.fleetPostBackupAbsent ||
    assertions.fleetAuditLength !== 1
  ) {
    throw new Error(`Recovery assertions failed: ${JSON.stringify(assertions)}`);
  }

  const completedAt = new Date();
  const measuredRpoSeconds = Math.max(
    0,
    (failureInjectedAt.getTime() - backupCompleted.getTime()) / 1000,
  );
  const measuredRtoSeconds = (performance.now() - restoreStarted) / 1000;
  if (measuredRpoSeconds > policy.targets.drillRpoSeconds) {
    throw new Error(
      `Recovery drill RPO ${measuredRpoSeconds}s exceeded ${policy.targets.drillRpoSeconds}s.`,
    );
  }
  if (measuredRtoSeconds > policy.targets.drillRtoSeconds) {
    throw new Error(
      `Recovery drill RTO ${measuredRtoSeconds}s exceeded ${policy.targets.drillRtoSeconds}s.`,
    );
  }

  const report = {
    schemaVersion: 1,
    status: 'passed',
    topology: policy.supportedTopology,
    startedAt: new Date(Date.now() - (performance.now() - backupStarted)).toISOString(),
    completedAt: completedAt.toISOString(),
    completedTimestampSeconds: Math.floor(completedAt.getTime() / 1000),
    commit: gitCommit(),
    targets: policy.targets,
    measuredRpoSeconds,
    measuredRtoSeconds,
    datasets: datasetReports,
    assertions,
    diagnosticBundle: { classification: 'redacted-operational-evidence', valid: true },
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const metrics = prometheusMetrics(report);
  await writeFile(join(outputDirectory, 'recovery-report.json'), reportText, { mode: 0o600 });
  await writeFile(join(outputDirectory, 'recovery-metrics.prom'), metrics, { mode: 0o600 });

  const diagnosticFiles = {
    'README.md': '# A2A Mesh disposable recovery drill evidence\n',
    'runtime-health.json': '{"status":"ok","authorization":"Bearer drill-secret"}\n',
    'runtime-metrics.prom': `a2a_runtime_tasks_active 0\n${metrics}`,
    'registry-metrics.prom': 'a2a_registry_agents 1\na2a_registry_healthy_agents 1\n',
    'registry-summary.json': '{"agents":1,"healthyAgents":1}\n',
    'version.txt': `commit=${report.commit}\n`,
    'environment-redacted.txt':
      'DEPLOYMENT_ENVIRONMENT=recovery-drill\nREGISTRY_TOKEN=drill-secret\n',
    'recovery-report.json': reportText,
    'recovery-metrics.prom': metrics,
  };
  for (const [name, content] of Object.entries(diagnosticFiles)) {
    await writeFile(join(diagnosticSource, name), content, { mode: 0o600 });
  }
  await createDiagnosticBundle({
    manifestPath: 'ops/recovery/diagnostic-bundle-manifest.json',
    sourceDirectory: diagnosticSource,
    outputDirectory: bundleDirectory,
  });
  await validateDiagnosticBundle({
    manifestPath: 'ops/recovery/diagnostic-bundle-manifest.json',
    bundleDirectory,
  });
  const bundleIndex = await readFile(join(bundleDirectory, 'bundle-index.json'), 'utf8');
  if (bundleIndex.includes(outputDirectory) || bundleIndex.includes('drill-secret')) {
    throw new Error('Recovery diagnostic bundle leaked an absolute path or drill secret.');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: report.status,
        datasets: report.datasets.length,
        measuredRpoSeconds: report.measuredRpoSeconds,
        measuredRtoSeconds: report.measuredRtoSeconds,
        output: basename(outputDirectory),
      },
      null,
      2,
    )}\n`,
  );
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRecoveryDrill().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
