import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { chmod, copyFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteFleetStorage } from '../../packages/fleet-server/src/storage/SqliteFleetStorage.js';
import { SqliteAgentStorage } from '../../packages/registry/src/storage/SqliteAgentStorage.js';
import { SqliteTrustLogStorage } from '../../packages/registry/src/storage/SqliteTrustLogStorage.js';
import { SqliteTaskStorage } from '../../packages/runtime/src/storage/SqliteTaskStorage.js';
import type { FleetRunRecord } from '../../packages/fleet-server/src/storage/IFleetStorage.js';
import type { RegisteredAgent } from '../../packages/registry/src/storage/IAgentStorage.js';
import type { Task } from '../../packages/runtime/src/types/task.js';
import {
  backupSqliteDatabase,
  pruneBackupSets,
  restoreSqliteBackup,
  verifySqliteBackup,
} from '../../scripts/recovery/sqlite-backup.mjs';
import {
  createDiagnosticBundle,
  validateDiagnosticBundle,
} from '../../scripts/recovery/diagnostic-bundle.mjs';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../..');
const recoveryCli = join(repoRoot, 'scripts/recovery-cli.mjs');

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function agent(id: string): RegisteredAgent {
  return {
    id,
    url: `https://${id}.example.com`,
    card: {
      protocolVersion: '1.0',
      name: `${id} Agent`,
      description: 'Recovery fixture agent',
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

function task(id: string): Task {
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

function run(id: string): FleetRunRecord {
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

describe('SQLite recovery operations', () => {
  it('takes online snapshots and restores registry, trust-log, task, and Fleet state', async () => {
    const root = createDirectory('a2amesh-recovery-');
    const source = join(root, 'source');
    const backups = join(root, 'backups');
    const restored = join(root, 'restored');
    mkdirSync(source, { recursive: true });

    const registryPath = join(source, 'registry.sqlite');
    const trustPath = join(source, 'trust-log.sqlite');
    const taskPath = join(source, 'tasks.sqlite');
    const fleetPath = join(source, 'fleet.sqlite');

    const registry = new SqliteAgentStorage(registryPath);
    const trustLog = new SqliteTrustLogStorage(trustPath);
    const tasks = new SqliteTaskStorage(taskPath);
    const fleet = new SqliteFleetStorage(fleetPath);

    await registry.upsert(agent('agent-before-backup'));
    await trustLog.append({
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

    const manifests = await Promise.all([
      backupSqliteDatabase({
        dataset: 'registry-agents',
        sourcePath: registryPath,
        outputDirectory: backups,
        now: () => new Date('2026-07-27T12:01:00.000Z'),
      }),
      backupSqliteDatabase({
        dataset: 'registry-trust-log',
        sourcePath: trustPath,
        outputDirectory: backups,
        now: () => new Date('2026-07-27T12:01:01.000Z'),
      }),
      backupSqliteDatabase({
        dataset: 'runtime-tasks',
        sourcePath: taskPath,
        outputDirectory: backups,
        now: () => new Date('2026-07-27T12:01:02.000Z'),
      }),
      backupSqliteDatabase({
        dataset: 'fleet-state',
        sourcePath: fleetPath,
        outputDirectory: backups,
        now: () => new Date('2026-07-27T12:01:03.000Z'),
      }),
    ]);

    expect(
      readdirSync(backups).filter(
        (name) => name.includes('.partial') || name.endsWith('-wal') || name.endsWith('-shm'),
      ),
    ).toEqual([]);

    await registry.upsert(agent('agent-after-backup'));
    await trustLog.append({
      cardHash: 'card-after-backup',
      keyId: 'key-recovery',
      algorithm: 'ES256',
      agentUrl: 'https://agent-after-backup.example.com',
      timestamp: '2026-07-27T12:02:00.000Z',
      tenantId: 'tenant-recovery',
    });
    tasks.insertTask(task('task-after-backup'));
    await fleet.createRun(run('run-after-backup'));

    registry.close();
    trustLog.close();
    tasks.close();
    fleet.close();

    const targets = [
      join(restored, 'registry.sqlite'),
      join(restored, 'trust-log.sqlite'),
      join(restored, 'tasks.sqlite'),
      join(restored, 'fleet.sqlite'),
    ];
    for (const [index, result] of manifests.entries()) {
      await expect(verifySqliteBackup(result.manifestPath)).resolves.toMatchObject({
        dataset: result.manifest.dataset,
        quickCheck: 'ok',
      });
      await restoreSqliteBackup({
        manifestPath: result.manifestPath,
        targetPath: targets[index]!,
      });
    }

    expect(readdirSync(restored).filter((name) => name.includes('restore-partial'))).toEqual([]);

    const restoredRegistry = new SqliteAgentStorage(targets[0]!);
    const restoredTrust = new SqliteTrustLogStorage(targets[1]!);
    const restoredTasks = new SqliteTaskStorage(targets[2]!);
    const restoredFleet = new SqliteFleetStorage(targets[3]!);

    await expect(restoredRegistry.get('agent-before-backup')).resolves.toMatchObject({
      id: 'agent-before-backup',
    });
    await expect(restoredRegistry.get('agent-after-backup')).resolves.toBeNull();
    await expect(restoredTrust.list()).resolves.toEqual([
      expect.objectContaining({ cardHash: 'card-before-backup', sequence: 0 }),
    ]);
    expect(restoredTasks.getTask('task-before-backup')?.id).toBe('task-before-backup');
    expect(restoredTasks.getTask('task-after-backup')).toBeUndefined();
    await expect(restoredFleet.getRun('run-before-backup')).resolves.toMatchObject({
      id: 'run-before-backup',
    });
    await expect(restoredFleet.getRun('run-after-backup')).resolves.toBeNull();
    await expect(restoredFleet.listAudit()).resolves.toEqual([
      expect.objectContaining({ action: 'task-routed', sequence: 0 }),
    ]);

    restoredRegistry.close();
    restoredTrust.close();
    restoredTasks.close();
    restoredFleet.close();
  });

  it('fails closed on tampering and keeps a rollback copy for explicit replacement', async () => {
    const root = createDirectory('a2amesh-recovery-tamper-');
    const sourcePath = join(root, 'source.sqlite');
    const targetPath = join(root, 'target.sqlite');
    const storage = new SqliteTaskStorage(sourcePath);
    storage.insertTask(task('task-original'));
    storage.close();

    const backup = await backupSqliteDatabase({
      dataset: 'runtime-tasks',
      sourcePath,
      outputDirectory: join(root, 'backups'),
      now: () => new Date('2026-07-27T13:00:00.000Z'),
    });

    const target = new SqliteTaskStorage(targetPath);
    target.insertTask(task('task-target-before-restore'));
    target.close();

    await expect(
      restoreSqliteBackup({ manifestPath: backup.manifestPath, targetPath }),
    ).rejects.toThrow(/already exists/i);

    const restored = await restoreSqliteBackup({
      manifestPath: backup.manifestPath,
      targetPath,
      replace: true,
      now: () => new Date('2026-07-27T13:01:00.000Z'),
    });
    expect(restored.rollbackFiles.map((path) => basename(path))).toContain(
      'target.sqlite.pre-restore-2026-07-27T13-01-00-000Z',
    );

    const reopened = new SqliteTaskStorage(targetPath);
    expect(reopened.getTask('task-original')?.id).toBe('task-original');
    expect(reopened.getTask('task-target-before-restore')).toBeUndefined();
    reopened.close();

    writeFileSync(
      backup.backupPath,
      Buffer.concat([readFileSync(backup.backupPath), Buffer.from('x')]),
    );
    await expect(verifySqliteBackup(backup.manifestPath)).rejects.toThrow(/size mismatch|sha-256/i);
  });

  it('prunes complete backup sets without leaving orphaned manifests', async () => {
    const root = createDirectory('a2amesh-recovery-retention-');
    const sourcePath = join(root, 'registry.sqlite');
    const storage = new SqliteAgentStorage(sourcePath);
    await storage.upsert(agent('agent-retention'));
    storage.close();

    for (const hour of [1, 2, 3]) {
      await backupSqliteDatabase({
        dataset: 'registry-agents',
        sourcePath,
        outputDirectory: join(root, 'backups'),
        now: () => new Date(`2026-07-27T0${hour}:00:00.000Z`),
      });
    }

    const result = await pruneBackupSets({
      dataset: 'registry-agents',
      outputDirectory: join(root, 'backups'),
      keepCount: 2,
    });
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.manifest).toMatch(/2026-07-27T01-00-00-000Z/);
  });
});

describe('diagnostic recovery bundle', () => {
  it('redacts secrets, private URLs, and raw task input while preserving recovery evidence', async () => {
    const root = createDirectory('a2amesh-diagnostics-');
    const source = join(root, 'source');
    const output = join(root, 'bundle');
    const manifestPath = join(root, 'bundle-manifest.json');
    mkdirSync(source, { recursive: true });

    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: '1.1',
        requiredFiles: [
          'README.md',
          'runtime-health.json',
          'runtime-metrics.prom',
          'registry-metrics.prom',
          'registry-summary.json',
          'version.txt',
          'environment-redacted.txt',
          'recovery-report.json',
          'recovery-metrics.prom',
        ],
        redactionRules: ['authorization', 'credentials', 'cookies', 'query tokens', 'task input'],
      }),
    );

    const fixtures: Record<string, string> = {
      'README.md': '# Recovery evidence\n',
      'runtime-health.json': '{"status":"ok","token":"runtime-secret"}',
      'runtime-metrics.prom': 'a2a_runtime_tasks_active 0\n',
      'registry-metrics.prom': 'a2a_registry_agents 1\n',
      'registry-summary.json': '{"agents":1}',
      'version.txt': 'commit=db3ad9a\n',
      'environment-redacted.txt':
        'AUTHORIZATION=Bearer production-token\nCOOKIE=session=private\nREGISTRY_TOKEN=super-secret\n',
      'recovery-report.json':
        '{"status":"passed","source":"http://10.0.0.8/private?token=abc","taskInput":"confidential prompt"}',
      'recovery-metrics.prom': 'a2a_recovery_backup_integrity_ok{dataset="registry"} 1\n',
    };
    for (const [name, content] of Object.entries(fixtures)) {
      writeFileSync(join(source, name), content);
    }

    const result = await createDiagnosticBundle({
      manifestPath,
      sourceDirectory: source,
      outputDirectory: output,
    });
    expect(result.files).toHaveLength(9);
    await expect(
      validateDiagnosticBundle({ manifestPath, bundleDirectory: output }),
    ).resolves.toMatchObject({
      valid: true,
      files: expect.arrayContaining(['recovery-report.json', 'recovery-metrics.prom']),
    });

    const combined = result.files
      .map((name) => readFileSync(join(output, name), 'utf8'))
      .join('\n');
    expect(combined).not.toContain('production-token');
    expect(combined).not.toContain('super-secret');
    expect(combined).not.toContain('session=private');
    expect(combined).not.toContain('10.0.0.8');
    expect(combined).not.toContain('confidential prompt');
    expect(combined).toContain('[REDACTED]');
    expect(readFileSync(join(output, 'bundle-index.json'), 'utf8')).not.toContain(root);
  });
});

describe('recovery fail-closed regressions', () => {
  it('rejects diagnostic bundles that contain unexpected files outside the signed index', async () => {
    const root = createDirectory('a2amesh-diagnostics-extra-');
    const source = join(root, 'source');
    const output = join(root, 'bundle');
    const manifestPath = join(root, 'bundle-manifest.json');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: '1.0',
        requiredFiles: ['README.md'],
        redactionRules: ['credentials', 'private task input', 'authorization'],
      }),
    );
    writeFileSync(join(source, 'README.md'), '# Redacted evidence\n');

    await createDiagnosticBundle({
      manifestPath,
      sourceDirectory: source,
      outputDirectory: output,
    });
    writeFileSync(join(output, 'raw-secrets.log'), 'REGISTRY_TOKEN=must-not-survive\n');

    await expect(
      validateDiagnosticBundle({ manifestPath, bundleDirectory: output }),
    ).rejects.toThrow(/unexpected/i);
  });

  it('keeps absolute host paths out of recovery CLI output', async () => {
    const root = createDirectory('a2amesh-recovery-cli-');
    const sourcePath = join(root, 'runtime.sqlite');
    const storage = new SqliteTaskStorage(sourcePath);
    storage.insertTask(task('task-cli-output'));
    storage.close();

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        recoveryCli,
        'backup',
        '--dataset',
        'runtime-tasks',
        '--source',
        sourcePath,
        '--output',
        join(root, 'backups'),
      ],
      { cwd: repoRoot, env: process.env, timeout: 30_000 },
    );

    expect(stdout).not.toContain(root);
    expect(stdout).toContain('runtime-tasks');
  });

  it('verifies the chart registry sentinel for both registration and list responses', async () => {
    const root = createDirectory('a2amesh-chart-persistence-');
    const fakeKubectl = join(root, 'kubectl');
    writeFileSync(
      fakeKubectl,
      '#!/usr/bin/env sh\ntrap "exit 0" TERM INT\nwhile :; do sleep 1; done\n',
      { mode: 0o700 },
    );

    const sentinelUrl = 'https://example.com/a2amesh-recovery-sentinel';
    const server = createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200).end('ok');
        return;
      }
      if (request.headers.authorization !== 'Bearer sentinel-test-token') {
        response.writeHead(401).end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST' && request.url === '/agents/register') {
        response.writeHead(201).end(JSON.stringify({ url: sentinelUrl }));
        return;
      }
      if (request.method === 'GET' && request.url === '/agents') {
        response.writeHead(200).end(JSON.stringify({ items: [{ url: sentinelUrl }] }));
        return;
      }
      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.');

    try {
      for (const mode of ['seed', 'verify']) {
        const result = await execFileAsync(
          '/usr/bin/bash',
          [join(repoRoot, 'scripts/verify-helm-registry-persistence.sh'), mode],
          {
            cwd: repoRoot,
            env: {
              ...process.env,
              KUBECTL_BIN: fakeKubectl,
              A2AMESH_REGISTRY_TOKEN: 'sentinel-test-token',
              A2AMESH_REGISTRY_PORT: String(address.port),
            },
            timeout: 30_000,
          },
        );
        expect(result.stdout).toContain(`Registry persistence sentinel ${mode} passed.`);
        expect(result.stdout).not.toContain('sentinel-test-token');
        expect(result.stderr).not.toContain('sentinel-test-token');
      }
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('removes a newly installed target when final permissions cannot be applied', async () => {
    const root = createDirectory('a2amesh-recovery-new-target-');
    const sourcePath = join(root, 'source.sqlite');
    const targetPath = join(root, 'target.sqlite');
    const source = new SqliteTaskStorage(sourcePath);
    source.insertTask(task('task-from-backup'));
    source.close();
    const backup = await backupSqliteDatabase({
      dataset: 'runtime-tasks',
      sourcePath,
      outputDirectory: join(root, 'backups'),
    });

    const fileOperations = {
      copyFile,
      rename,
      rm,
      chmod: async (path: string, mode: number) => {
        if (path === targetPath) throw new Error('injected final permission failure');
        await chmod(path, mode);
      },
    };

    await expect(
      restoreSqliteBackup({
        manifestPath: backup.manifestPath,
        targetPath,
        fileOperations,
      }),
    ).rejects.toThrow(/injected final permission failure/i);
    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(`${targetPath}-wal`)).toBe(false);
    expect(existsSync(`${targetPath}-shm`)).toBe(false);
  });

  it('restores the original database and WAL sidecars when the final replacement fails', async () => {
    const root = createDirectory('a2amesh-recovery-rollback-');
    const sourcePath = join(root, 'source.sqlite');
    const targetPath = join(root, 'target.sqlite');
    const source = new SqliteTaskStorage(sourcePath);
    source.insertTask(task('task-from-backup'));
    source.close();
    const target = new SqliteTaskStorage(targetPath);
    target.insertTask(task('task-original-target'));
    target.close();
    writeFileSync(`${targetPath}-wal`, 'original-wal');
    writeFileSync(`${targetPath}-shm`, 'original-shm');

    const backup = await backupSqliteDatabase({
      dataset: 'runtime-tasks',
      sourcePath,
      outputDirectory: join(root, 'backups'),
    });

    const fileOperations = {
      chmod,
      copyFile,
      rm,
      rename: async (from: string, to: string) => {
        if (from.includes('restore-partial')) throw new Error('injected final rename failure');
        await rename(from, to);
      },
    };

    await expect(
      restoreSqliteBackup({
        manifestPath: backup.manifestPath,
        targetPath,
        replace: true,
        fileOperations,
      } as Parameters<typeof restoreSqliteBackup>[0] & { fileOperations: typeof fileOperations }),
    ).rejects.toThrow(/injected final rename failure/i);

    expect(readFileSync(`${targetPath}-wal`, 'utf8')).toBe('original-wal');
    expect(readFileSync(`${targetPath}-shm`, 'utf8')).toBe('original-shm');
    const reopened = new SqliteTaskStorage(targetPath);
    expect(reopened.getTask('task-original-target')?.id).toBe('task-original-target');
    expect(reopened.getTask('task-from-backup')).toBeUndefined();
    reopened.close();
  });
});
