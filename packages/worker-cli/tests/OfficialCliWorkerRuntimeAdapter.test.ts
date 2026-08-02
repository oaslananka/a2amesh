import { mkdirSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  FleetProviderWorkerPlan,
  FleetSideEffectLevel,
  FleetWorkerRunAdmission,
  WorkerCard,
} from '@a2amesh/internal-fleet';
import type { WorkerRuntimeContext, WorkerRuntimeEvent } from '@a2amesh/internal-worker-runtime';
import { OfficialCliWorkerRuntimeAdapter } from '../src/index.js';

const directories: string[] = [];
const command = realpathSync(process.execPath);
const card: WorkerCard = {
  protocolVersion: '1.0',
  name: 'official-cli-worker',
  description: 'Policy-backed official CLI worker.',
  url: 'local-cli://official-cli-worker',
  version: '1.0.0',
  fleetRoles: ['code-worker'],
};

const providerPlan: FleetProviderWorkerPlan = {
  providerId: 'documented-official-cli',
  workerRole: 'code-worker',
  supportStatus: 'experimental',
  allowedSurfaces: ['official-cli', 'artifact-handoff', 'git-worktree'],
  forbiddenSurfaces: [
    'browser-session',
    'web-ui-scraping',
    'private-endpoint',
    'token-extraction',
    'subscription-bypass',
  ],
  capabilities: ['code-review', 'patch-generation'],
  credentialPolicy: 'official-cli-session',
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  delete process.env['A2AMESH_ALLOWED_REF'];
  delete process.env['A2AMESH_HIDDEN_REF'];
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'a2amesh-official-cli-'));
  directories.push(directory);
  return directory;
}

function context(runId = 'run-1'): WorkerRuntimeContext {
  const now = '2026-08-02T00:00:00.000Z';
  return {
    task: {
      id: 'task-1',
      description: 'Produce a reviewed patch.',
      status: { state: 'WORKING', timestamp: now },
      createdAt: now,
      updatedAt: now,
    },
    worker: { id: 'official-cli-worker', card, status: 'IDLE', lastSeenAt: now },
    run: {
      id: runId,
      taskId: 'task-1',
      workerId: 'official-cli-worker',
      status: 'RUNNING',
    },
  };
}

function admission(
  sideEffectLevel: FleetSideEffectLevel,
  state: FleetWorkerRunAdmission['decision']['approval']['state'],
): FleetWorkerRunAdmission {
  const write = sideEffectLevel !== 'read-only';
  return {
    taskId: 'task-1',
    workerId: 'official-cli-worker',
    decision: {
      allowed: true,
      sideEffectLevel,
      sandbox: {
        isolation: 'process',
        network: 'disabled',
        filesystem: write ? 'workspace-write' : 'read-only',
        allowedCommands: [command],
      },
      artifactPolicy: {
        sensitivity: 'internal',
        allowedArtifactTypes: ['patch', 'json'],
        requireChecksum: true,
        requireRedaction: true,
      },
      approval: {
        requiredFor: write ? [sideEffectLevel] : [],
        state,
        ...(state === 'APPROVED' ? { approver: 'maintainer' } : {}),
      },
      evidence: ['policy:test'],
    },
    boundaries: [
      {
        level: sideEffectLevel,
        requiresApproval: write,
        requiresAudit: true,
        permittedCommands: [command],
      },
    ],
  };
}

function adapter(
  root: string,
  overrides: Partial<ConstructorParameters<typeof OfficialCliWorkerRuntimeAdapter>[0]> = {},
): OfficialCliWorkerRuntimeAdapter {
  return new OfficialCliWorkerRuntimeAdapter({
    id: 'official-cli-worker',
    card,
    providerPlan,
    command,
    buildArgs: () => [
      '-e',
      "require('node:fs').writeFileSync('out.patch', 'diff --git a/file b/file\\n+safe\\n')",
    ],
    artifactFiles: () => ['out.patch'],
    resolveAdmission: () => admission('read-only', 'NOT_REQUIRED'),
    policy: { commandAllowlist: [command], workspaceRoot: root },
    ...overrides,
  });
}

async function collect(stream: AsyncIterable<WorkerRuntimeEvent>): Promise<WorkerRuntimeEvent[]> {
  const events: WorkerRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('OfficialCliWorkerRuntimeAdapter', () => {
  it('rejects a relative command before execution', () => {
    expect(() => adapter(workspace(), { command: 'vendor-cli' })).toThrow(/absolute/i);
  });

  it('requires official CLI and artifact handoff provider surfaces', () => {
    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, allowedSurfaces: ['artifact-handoff'] },
      }),
    ).toThrow(/official-cli/i);
  });

  it('requires every unsafe provider surface to stay forbidden', () => {
    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, forbiddenSurfaces: ['browser-session'] },
      }),
    ).toThrow(/forbidden/i);
  });

  it('does not accept environment references for an official CLI session plan', () => {
    expect(() => adapter(workspace(), { environmentReferences: ['A2AMESH_ALLOWED_REF'] })).toThrow(
      /official-cli-session/i,
    );
  });

  it('runs a read-only admitted command and verifies a checksummed artifact', async () => {
    const worker = adapter(workspace());
    const ctx = context();

    expect((await worker.prepare(ctx)).type).toBe('prepared');
    expect((await worker.start(ctx)).type).toBe('started');
    const events = await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });
    const verification = await worker.verify(ctx);

    expect(events.at(-1)?.type).toBe('finalized');
    expect(result.status).toBe('COMPLETED');
    expect(result.artifacts?.[0]?.metadata?.['checksumSha256']).toMatch(/^[a-f0-9]{64}$/u);
    expect(verification.status).toBe('PASSED');
  });

  it('denies local repository mutation until approval is explicit', async () => {
    const root = workspace();
    const worker = adapter(root, {
      resolveAdmission: () => admission('local-write', 'PENDING'),
    });

    const event = await worker.prepare(context());
    expect(event).toMatchObject({ type: 'failed', failure: { code: 'POLICY_DENIED' } });
    expect(event.failure?.message).toMatch(/approval/i);
  });

  it('allows approved local-write worktree mutation', async () => {
    const worker = adapter(workspace(), {
      resolveAdmission: () => admission('local-write', 'APPROVED'),
    });
    const ctx = context('local-write');

    expect((await worker.prepare(ctx)).type).toBe('prepared');
    await worker.start(ctx);
    await collect(worker.stream(ctx));
    expect((await worker.finalize(ctx, { status: 'RUNNING' })).status).toBe('COMPLETED');
  });

  it.each(['remote-write', 'publish', 'deploy'] as const)(
    'denies %s side effects even when approval is present',
    async (level) => {
      const worker = adapter(workspace(), {
        resolveAdmission: () => admission(level, 'APPROVED'),
      });
      const event = await worker.prepare(context());
      expect(event).toMatchObject({ type: 'failed', failure: { code: 'POLICY_DENIED' } });
      expect(event.failure?.message).toContain(level);
    },
  );

  it('forwards only named environment references under env-ref policy', async () => {
    process.env['A2AMESH_ALLOWED_REF'] = 'allowed-value';
    process.env['A2AMESH_HIDDEN_REF'] = 'hidden-value';
    const worker = adapter(workspace(), {
      providerPlan: { ...providerPlan, credentialPolicy: 'env-ref' },
      environmentReferences: ['A2AMESH_ALLOWED_REF'],
      buildArgs: () => [
        '-e',
        "require('node:fs').writeFileSync('out.json', JSON.stringify({allowed:process.env.A2AMESH_ALLOWED_REF==='allowed-value',hidden:process.env.A2AMESH_HIDDEN_REF!==undefined}))",
      ],
      artifactFiles: () => ['out.json'],
    });
    const ctx = context('env-ref');

    await worker.start(ctx);
    await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });
    const bytes = result.artifacts?.[0]?.parts[0];
    expect(bytes?.type).toBe('file');
    if (bytes?.type !== 'file') throw new Error('expected file artifact');
    const payload = JSON.parse(Buffer.from(bytes.file.bytes ?? '', 'base64').toString('utf8')) as {
      allowed: boolean;
      hidden: boolean;
    };
    expect(payload).toEqual({ allowed: true, hidden: false });
  });

  it('binds admission to the current task, worker, and command', async () => {
    const mismatched = admission('read-only', 'NOT_REQUIRED');
    mismatched.taskId = 'other-task';
    const worker = adapter(workspace(), { resolveAdmission: () => mismatched });

    const event = await worker.prepare(context());
    expect(event).toMatchObject({ type: 'failed', failure: { code: 'POLICY_DENIED' } });
    expect(event.failure?.message).toMatch(/task/i);
  });

  it('fails closed for invalid worker configuration variants', () => {
    expect(() => adapter(workspace(), { id: '   ' })).toThrow(/id/i);
    expect(() =>
      adapter(workspace(), { policy: { commandAllowlist: [], workspaceRoot: workspace() } }),
    ).toThrow(/allowlist/i);
    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, allowedSurfaces: ['official-cli'] },
      }),
    ).toThrow(/artifact-handoff/i);

    for (const supportStatus of ['manual-only', 'unsupported'] as const) {
      expect(() =>
        adapter(workspace(), { providerPlan: { ...providerPlan, supportStatus } }),
      ).toThrow(/supported or experimental/i);
    }

    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, credentialPolicy: 'secret-manager-ref' },
      }),
    ).toThrow(/credentials/i);
    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, credentialPolicy: 'env-ref' },
        environmentReferences: Array.from({ length: 33 }, (_, index) => `ENV_${index}`),
      }),
    ).toThrow(/at most 32/i);
    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, credentialPolicy: 'env-ref' },
        environmentReferences: ['DUPLICATE_REF', 'DUPLICATE_REF'],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      adapter(workspace(), {
        providerPlan: { ...providerPlan, credentialPolicy: 'env-ref' },
        environmentReferences: ['invalid-ref'],
      }),
    ).toThrow(/invalid/i);
  });

  it('supports fixed arguments and a confined relative working directory', async () => {
    const root = workspace();
    mkdirSync(join(root, 'nested'));
    const worker = adapter(root, {
      baseArgs: ['-e'],
      buildArgs: () => [
        "require('node:fs').writeFileSync('out.patch', 'diff --git a/nested b/nested')",
      ],
      cwd: 'nested',
      artifactFiles: () => ['out.patch'],
    });
    const ctx = context('base-args');

    await worker.start(ctx);
    await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('COMPLETED');
    expect(result.artifacts?.[0]?.name).toBe('out.patch');
  });

  it('fails closed when run identity or admission resolution is invalid', async () => {
    const wrongWorker = context('wrong-worker');
    wrongWorker.run.workerId = 'other-worker';
    const worker = adapter(workspace());
    expect(await worker.start(wrongWorker)).toMatchObject({
      type: 'failed',
      failure: { code: 'POLICY_DENIED', operation: 'start' },
    });

    const failingResolver = adapter(workspace(), {
      resolveAdmission: () => {
        throw new Error('secret resolver detail');
      },
    });
    const event = await failingResolver.prepare(context('resolver-failure'));
    expect(event.failure?.message).toBe('Fleet admission resolution failed closed.');
    expect(event.failure?.message).not.toContain('secret resolver detail');
  });

  it('denies malformed or insufficient Fleet admissions', async () => {
    const cases: Array<{
      name: string;
      level?: FleetSideEffectLevel;
      mutate: (value: FleetWorkerRunAdmission) => void;
      pattern: RegExp;
      providerPlan?: FleetProviderWorkerPlan;
      metadata?: WorkerRuntimeContext['metadata'];
    }> = [
      {
        name: 'worker binding',
        mutate: (value) => {
          value.workerId = 'other-worker';
        },
        pattern: /different worker/i,
      },
      {
        name: 'explicit denial reason',
        mutate: (value) => {
          value.decision.allowed = false;
          value.decision.denialReason = 'operator policy denied';
        },
        pattern: /operator policy denied/i,
      },
      {
        name: 'default denial reason',
        mutate: (value) => {
          value.decision.allowed = false;
          delete value.decision.denialReason;
        },
        pattern: /policy denied/i,
      },
      {
        name: 'missing worktree surface',
        level: 'local-write',
        mutate: () => {},
        providerPlan: {
          ...providerPlan,
          allowedSurfaces: ['official-cli', 'artifact-handoff'],
        },
        pattern: /git-worktree/i,
      },
      {
        name: 'no isolation',
        mutate: (value) => {
          value.decision.sandbox.isolation = 'none';
        },
        pattern: /isolation/i,
      },
      {
        name: 'missing command binding',
        mutate: (value) => {
          delete value.decision.sandbox.allowedCommands;
        },
        pattern: /absolute official CLI command/i,
      },
      {
        name: 'blocked command',
        mutate: (value) => {
          value.decision.sandbox.blockedCommands = [command];
        },
        pattern: /blocks/i,
      },
      {
        name: 'read-only writable filesystem',
        mutate: (value) => {
          value.decision.sandbox.filesystem = 'workspace-write';
        },
        pattern: /read-only/i,
      },
      {
        name: 'local-write read-only filesystem',
        level: 'local-write',
        mutate: (value) => {
          value.decision.sandbox.filesystem = 'read-only';
        },
        pattern: /workspace-write/i,
      },
      {
        name: 'missing boundary',
        mutate: (value) => {
          value.boundaries = [];
        },
        pattern: /missing.*boundary/i,
      },
      {
        name: 'audit disabled',
        mutate: (value) => {
          value.boundaries[0]!.requiresAudit = false;
        },
        pattern: /audit/i,
      },
      {
        name: 'boundary command mismatch',
        mutate: (value) => {
          value.boundaries[0]!.permittedCommands = ['/other/command'];
        },
        pattern: /does not permit/i,
      },
      {
        name: 'local-write not approval marked',
        level: 'local-write',
        mutate: (value) => {
          value.boundaries[0]!.requiresApproval = false;
        },
        pattern: /approval-required/i,
      },
      {
        name: 'local-write approval list missing',
        level: 'local-write',
        mutate: (value) => {
          value.decision.approval.requiredFor = [];
        },
        pattern: /approval-required/i,
      },
      {
        name: 'local-write approver missing',
        level: 'local-write',
        mutate: (value) => {
          delete value.decision.approval.approver;
        },
        pattern: /maintainer approval/i,
      },
      {
        name: 'read-only pending approval',
        mutate: (value) => {
          value.decision.approval.requiredFor = ['read-only'];
          value.decision.approval.state = 'PENDING';
        },
        pattern: /approval-gated/i,
      },
      {
        name: 'invalid expiry',
        mutate: (value) => {
          value.decision.approval.expiresAt = 'not-a-date';
        },
        pattern: /invalid or expired/i,
      },
      {
        name: 'expired approval',
        mutate: (value) => {
          value.decision.approval.expiresAt = '2000-01-01T00:00:00.000Z';
        },
        pattern: /invalid or expired/i,
      },
      {
        name: 'checksum disabled',
        mutate: (value) => {
          value.decision.artifactPolicy.requireChecksum = false;
        },
        pattern: /checksums/i,
      },
      {
        name: 'redaction disabled',
        mutate: (value) => {
          value.decision.artifactPolicy.requireRedaction = false;
        },
        pattern: /redaction/i,
      },
      {
        name: 'requested level mismatch',
        mutate: () => {},
        metadata: { sideEffectLevel: 'local-write' },
        pattern: /does not match/i,
      },
    ];

    for (const testCase of cases) {
      const value = admission(
        testCase.level ?? 'read-only',
        testCase.level ? 'APPROVED' : 'NOT_REQUIRED',
      );
      testCase.mutate(value);
      const worker = adapter(workspace(), {
        providerPlan: testCase.providerPlan ?? providerPlan,
        resolveAdmission: () => value,
      });
      const ctx = context(`denial-${testCase.name}`);
      if (testCase.metadata) ctx.metadata = testCase.metadata;
      const event = await worker.prepare(ctx);
      expect(event.failure?.message, testCase.name).toMatch(testCase.pattern);
    }
  });

  it('delegates observation, cancellation, and cleanup lifecycle methods', async () => {
    const root = workspace();
    const worker = adapter(root, {
      buildArgs: () => ['-e', 'setTimeout(() => {}, 5000)'],
      artifactFiles: () => [],
      policy: { commandAllowlist: [command], workspaceRoot: root, timeoutMs: 10_000 },
    });
    const ctx = context('cancel-run');

    expect((await worker.cleanup(context('never-started'))).type).toBe('cleaned-up');
    expect((await worker.start(ctx)).type).toBe('started');
    expect((await worker.observe(ctx)).runId).toBe(ctx.run.id);
    await worker.cancel(ctx, {
      requestedAt: new Date().toISOString(),
      requestedBy: 'operator',
      reason: 'coverage cancellation',
    });
    const events = await collect(worker.stream(ctx));
    expect(events.at(-1)?.type).toBe('canceled');
    expect((await worker.cleanup(ctx)).type).toBe('cleaned-up');
  });
});
