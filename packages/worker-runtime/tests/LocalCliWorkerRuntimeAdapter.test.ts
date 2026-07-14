import { basename, join } from 'node:path';
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalCliWorkerRuntimeAdapter } from '../src/adapters/LocalCliWorkerRuntimeAdapter.js';
import { readConfinedRegularFile } from '../src/security/pathConfinement.js';
import type { WorkerRuntimeContext, WorkerRuntimeEvent } from '../src/types/lifecycle.js';

const tempDirectories: string[] = [];
const nodeExecutable = realpathSync(process.execPath);

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workspace(prefix = 'a2amesh-cli-adapter-'): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

function context(overrides: Partial<WorkerRuntimeContext> = {}): WorkerRuntimeContext {
  return {
    task: {
      id: 'task-1',
      description: 'hello',
      status: { state: 'WORKING', timestamp: '2026-07-03T00:00:00.000Z' },
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
    },
    worker: {
      id: 'cli-worker',
      card: {
        protocolVersion: '1.0',
        name: 'CLI',
        description: 'cli worker',
        url: 'http://cli.local',
        version: '1.0.0',
      },
      status: 'IDLE',
      lastSeenAt: '2026-07-03T00:00:00.000Z',
    },
    run: {
      id: `run-${Math.random().toString(36).slice(2)}`,
      taskId: 'task-1',
      workerId: 'cli-worker',
      status: 'RUNNING',
    },
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<WorkerRuntimeEvent>): Promise<WorkerRuntimeEvent[]> {
  const events: WorkerRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const card = {
  protocolVersion: '1.0',
  name: 'CLI',
  description: 'cli worker',
  url: 'http://cli.local',
  version: '1.0.0',
} as const;

function nodeAdapter(
  workspaceRoot: string,
  overrides: Partial<ConstructorParameters<typeof LocalCliWorkerRuntimeAdapter>[0]> = {},
): LocalCliWorkerRuntimeAdapter {
  const policyOverrides = overrides.policy ?? {};
  return new LocalCliWorkerRuntimeAdapter({
    id: 'cli-worker',
    card,
    command: nodeExecutable,
    ...overrides,
    policy: {
      commandAllowlist: [nodeExecutable],
      workspaceRoot,
      ...policyOverrides,
    },
  });
}

async function runAndFinalize(
  adapter: LocalCliWorkerRuntimeAdapter,
  ctx = context(),
): Promise<{ events: WorkerRuntimeEvent[]; result: Awaited<ReturnType<typeof adapter.finalize>> }> {
  await adapter.start(ctx);
  const events = await collect(adapter.stream(ctx));
  const result = await adapter.finalize(ctx, { status: 'RUNNING' });
  return { events, result };
}

describe('LocalCliWorkerRuntimeAdapter', () => {
  it('runs a canonical allowlisted executable in the scoped workspace', async () => {
    const adapter = nodeAdapter(workspace(), {
      buildArgs: () => ['-e', "console.log('hello from worker')"],
    });
    const { events, result } = await runAndFinalize(adapter);
    expect(events.at(-1)?.type).toBe('finalized');
    expect(events.some((event) => event.message?.includes('hello from worker'))).toBe(true);
    expect(result.status).toBe('COMPLETED');
  });

  it('blocks bare commands so ambient PATH lookup cannot select an executable', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: basename(nodeExecutable),
      policy: { commandAllowlist: [nodeExecutable], workspaceRoot },
    });
    const startEvent = await adapter.start(context());
    expect(startEvent.type).toBe('failed');
    expect(startEvent.failure?.message).toContain('absolute executable path');
  });

  it('blocks executable paths outside the canonical allowlist', async () => {
    const workspaceRoot = workspace();
    const fakeExecutable = join(workspaceRoot, 'fake-node');
    writeFileSync(fakeExecutable, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeExecutable, 0o755);
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: fakeExecutable,
      policy: { commandAllowlist: [nodeExecutable], workspaceRoot },
    });
    const startEvent = await adapter.start(context());
    expect(startEvent.type).toBe('failed');
    expect(startEvent.failure?.message).toContain('not in the executable allowlist');
  });

  it.skipIf(process.platform === 'win32')(
    'blocks executable symlinks even when their target is allowlisted',
    async () => {
      const workspaceRoot = workspace();
      const executableLink = join(workspaceRoot, 'node-link');
      symlinkSync(nodeExecutable, executableLink, 'file');
      const adapter = new LocalCliWorkerRuntimeAdapter({
        id: 'cli-worker',
        card,
        command: executableLink,
        policy: { commandAllowlist: [nodeExecutable], workspaceRoot },
      });
      const startEvent = await adapter.start(context());
      expect(startEvent.type).toBe('failed');
      expect(startEvent.failure?.message).toContain('symbolic link');
    },
  );

  it('does not use an attacker-controlled PATH entry when spawning', async () => {
    const workspaceRoot = workspace();
    const fakeBin = workspace('a2amesh-fake-bin-');
    const fakeName = join(fakeBin, basename(nodeExecutable));
    writeFileSync(fakeName, '#!/bin/sh\necho PATH-SUBSTITUTED\n');
    chmodSync(fakeName, 0o755);
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', "console.log('CANONICAL-NODE')"],
      env: { PATH: fakeBin },
    });
    const { events, result } = await runAndFinalize(adapter);
    const output = events.map((event) => event.message).join('\n');
    expect(result.status).toBe('COMPLETED');
    expect(output).toContain('CANONICAL-NODE');
    expect(output).not.toContain('PATH-SUBSTITUTED');
  });

  it('blocks lexical working-directory escapes', async () => {
    const adapter = nodeAdapter(workspace(), { cwd: '../outside' });
    const startEvent = await adapter.start(context());
    expect(startEvent.type).toBe('failed');
    expect(startEvent.failure?.message).toContain('escapes workspace root');
  });

  it('blocks a working-directory symlink or junction that resolves outside the workspace', async () => {
    const workspaceRoot = workspace();
    const outside = workspace('a2amesh-outside-');
    const link = join(workspaceRoot, 'linked-cwd');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const adapter = nodeAdapter(workspaceRoot, { cwd: 'linked-cwd' });
    const startEvent = await adapter.start(context());
    expect(startEvent.type).toBe('failed');
    expect(startEvent.failure?.message).toMatch(/symbolic link|escapes workspace root/);
  });

  it('does not forward ambient environment variables outside the allowlist', async () => {
    const workspaceRoot = workspace();
    process.env['A2AMESH_TEST_SECRET'] = 'super-secret-value';
    try {
      const adapter = nodeAdapter(workspaceRoot, {
        buildArgs: () => ['-e', 'console.log(JSON.stringify(process.env))'],
        policy: {
          commandAllowlist: [nodeExecutable],
          workspaceRoot,
          envAllowlist: [],
        },
      });
      const { events } = await runAndFinalize(adapter);
      expect(events.map((event) => event.message).join('\n')).not.toContain('super-secret-value');
    } finally {
      delete process.env['A2AMESH_TEST_SECRET'];
    }
  });

  it('redacts credential values even when stdout writes them across chunk boundaries', async () => {
    const secret = 'split-super-secret-value';
    const adapter = nodeAdapter(workspace(), {
      env: { API_KEY: secret },
      buildArgs: () => [
        '-e',
        "process.stdout.write('api_key=split-super-'); setTimeout(() => process.stdout.write('secret-value\\n'), 10)",
      ],
    });
    const { events, result } = await runAndFinalize(adapter);
    const output = events.map((event) => event.message).join('\n');
    expect(result.status).toBe('COMPLETED');
    expect(output).not.toContain(secret);
    expect(output).toContain('[REDACTED]');
  });

  it('drops a partial output line when the byte cap cuts through a credential', async () => {
    const secret = 'split-super-secret-value';
    const workspaceRoot = workspace();
    const adapter = nodeAdapter(workspaceRoot, {
      env: { API_KEY: secret },
      buildArgs: () => ['-e', 'process.stdout.write(process.env.API_KEY)'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot,
        maxOutputBytes: 10,
      },
    });
    const { events, result } = await runAndFinalize(adapter);
    const output = events.map((event) => event.message).join('\n');
    expect(result.status).toBe('COMPLETED');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(secret.slice(0, 10));
    expect(output).toContain('[output truncated]');
  });

  it('aborts and reports a timeout when the process exceeds the configured limit', async () => {
    const workspaceRoot = workspace();
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', 'setTimeout(() => {}, 5000)'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot,
        timeoutMs: 50,
      },
    });
    const { events } = await runAndFinalize(adapter);
    expect(events.at(-1)?.type).toBe('failed');
    expect(events.at(-1)?.failure).toEqual(
      expect.objectContaining({ code: 'TIMEOUT', retryable: true }),
    );
  }, 10_000);

  it('supports cancellation of an in-flight run', async () => {
    const workspaceRoot = workspace();
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', 'setTimeout(() => {}, 5000)'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot,
        timeoutMs: 10_000,
      },
    });
    const ctx = context();
    await adapter.start(ctx);
    await adapter.cancel(ctx, {
      requestedAt: new Date().toISOString(),
      reason: 'operator canceled',
    });
    const events = await collect(adapter.stream(ctx));
    expect(events.at(-1)?.type).toBe('canceled');
    expect((await adapter.finalize(ctx, { status: 'RUNNING' })).status).toBe('CANCELED');
  }, 10_000);

  it('captures declared regular UTF-8 files as bounded checksummed artifacts', async () => {
    const adapter = nodeAdapter(workspace(), {
      buildArgs: () => ['-e', "require('node:fs').writeFileSync('out.patch', 'diff --git a b')"],
      artifactFiles: () => ['out.patch'],
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('COMPLETED');
    expect(result.artifacts?.[0]?.name).toBe('out.patch');
    expect(result.artifacts?.[0]?.metadata?.['checksumSha256']).toMatch(/^[a-f0-9]{64}$/);
  });

  it.skipIf(process.platform === 'win32')(
    'fails closed when a declared artifact is a symbolic link',
    async () => {
      const workspaceRoot = workspace();
      const outside = workspace('a2amesh-outside-');
      writeFileSync(join(outside, 'secret.patch'), 'outside secret');
      const adapter = nodeAdapter(workspaceRoot, {
        buildArgs: () => [
          '-e',
          `require('node:fs').symlinkSync(${JSON.stringify(join(outside, 'secret.patch'))}, 'out.patch')`,
        ],
        artifactFiles: () => ['out.patch'],
      });
      const { events, result } = await runAndFinalize(adapter);
      expect(result.status).toBe('FAILED');
      expect(result.failure?.code).toBe('ARTIFACT_UNAVAILABLE');
      expect(events.at(-1)?.failure?.message).toContain('symbolic link');
    },
  );

  it('fails closed when an artifact parent is a symlink or junction outside the workspace', async () => {
    const workspaceRoot = workspace();
    const outside = workspace('a2amesh-outside-');
    writeFileSync(join(outside, 'secret.patch'), 'outside secret');
    symlinkSync(
      outside,
      join(workspaceRoot, 'out'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', "console.log('done')"],
      artifactFiles: () => ['out/secret.patch'],
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe('ARTIFACT_UNAVAILABLE');
    expect(result.failure?.message).toMatch(/symbolic link|escapes workspace root/);
  });

  it('fails closed on a parent symlink even when the target artifact is missing', async () => {
    const workspaceRoot = workspace();
    const outside = workspace('a2amesh-outside-');
    symlinkSync(
      outside,
      join(workspaceRoot, 'out'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', "console.log('done')"],
      artifactFiles: () => ['out/missing.patch'],
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('FAILED');
    expect(result.failure?.code).toBe('ARTIFACT_UNAVAILABLE');
    expect(result.failure?.message).toContain('symbolic link');
  });

  it('rejects directories and other non-regular artifact entries', async () => {
    const adapter = nodeAdapter(workspace(), {
      buildArgs: () => ['-e', "require('node:fs').mkdirSync('report.patch')"],
      artifactFiles: () => ['report.patch'],
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('FAILED');
    expect(result.failure?.message).toContain('not a regular file');
  });

  it.skipIf(process.platform === 'win32')('rejects Unix socket artifacts', async () => {
    const workspaceRoot = workspace();
    const socketPath = join(workspaceRoot, 'report.patch');
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      const adapter = nodeAdapter(workspaceRoot, {
        buildArgs: () => ['-e', "console.log('done')"],
        artifactFiles: () => ['report.patch'],
      });
      const { result } = await runAndFinalize(adapter);
      expect(result.status).toBe('FAILED');
      expect(result.failure?.message).toContain('not a regular file');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('enforces artifact extension restrictions', async () => {
    const adapter = nodeAdapter(workspace(), {
      buildArgs: () => ['-e', "require('node:fs').writeFileSync('payload.exe', 'text')"],
      artifactFiles: () => ['payload.exe'],
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('FAILED');
    expect(result.failure?.message).toContain('disallowed extension');
  });

  it('rejects binary artifact content unless explicitly enabled', async () => {
    const adapter = nodeAdapter(workspace(), {
      buildArgs: () => [
        '-e',
        "require('node:fs').writeFileSync('payload.patch', Buffer.from([0, 1, 2]))",
      ],
      artifactFiles: () => ['payload.patch'],
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('FAILED');
    expect(result.failure?.message).toContain('binary artifacts are disabled');
  });

  it('enforces per-file and aggregate artifact byte limits', async () => {
    const perFileWorkspace = workspace();
    const perFile = nodeAdapter(perFileWorkspace, {
      buildArgs: () => ['-e', "require('node:fs').writeFileSync('large.patch', '12345')"],
      artifactFiles: () => ['large.patch'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot: perFileWorkspace,
        maxArtifactBytes: 4,
      },
    });
    expect((await runAndFinalize(perFile)).result.status).toBe('FAILED');

    const aggregateWorkspace = workspace();
    const aggregate = nodeAdapter(aggregateWorkspace, {
      buildArgs: () => [
        '-e',
        "const fs=require('node:fs'); fs.writeFileSync('a.patch','123'); fs.writeFileSync('b.patch','456')",
      ],
      artifactFiles: () => ['a.patch', 'b.patch'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot: aggregateWorkspace,
        maxArtifactBytes: 10,
        maxTotalArtifactBytes: 5,
      },
    });
    expect((await runAndFinalize(aggregate)).result.status).toBe('FAILED');
  });

  it('enforces the declared artifact count limit before reading files', async () => {
    const workspaceRoot = workspace();
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', "console.log('done')"],
      artifactFiles: () => ['a.patch', 'b.patch'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot,
        maxArtifactFiles: 1,
      },
    });
    const { result } = await runAndFinalize(adapter);
    expect(result.status).toBe('FAILED');
    expect(result.failure?.message).toContain('artifact count');
  });

  it('redacts credential-shaped artifact names and metadata', async () => {
    const adapter = nodeAdapter(workspace(), {
      buildArgs: () => [
        '-e',
        "require('node:fs').writeFileSync('api_key=super-secret.patch', 'safe report')",
      ],
      artifactFiles: () => ['api_key=super-secret.patch'],
    });
    const { result } = await runAndFinalize(adapter);
    const serialized = JSON.stringify(result.artifacts);
    expect(result.status).toBe('COMPLETED');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).toContain('[REDACTED]');
  });

  it('denies runs beyond the configured concurrency limit', async () => {
    const workspaceRoot = workspace();
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', 'setTimeout(() => {}, 300)'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot,
        maxConcurrentRuns: 1,
        timeoutMs: 10_000,
      },
    });
    const first = context();
    await adapter.start(first);
    const second = context({
      run: { id: 'run-second', taskId: 'task-1', workerId: 'cli-worker', status: 'RUNNING' },
    });
    const secondStart = await adapter.start(second);
    expect(secondStart.type).toBe('failed');
    expect(secondStart.failure?.message).toContain('concurrency limit');
    await adapter.cancel(first, { requestedAt: new Date().toISOString() });
    await collect(adapter.stream(first));
  }, 10_000);

  it('reserves concurrency slots before asynchronous path resolution', async () => {
    const workspaceRoot = workspace();
    const adapter = nodeAdapter(workspaceRoot, {
      buildArgs: () => ['-e', 'setTimeout(() => {}, 300)'],
      policy: {
        commandAllowlist: [nodeExecutable],
        workspaceRoot,
        maxConcurrentRuns: 1,
        timeoutMs: 10_000,
      },
    });
    const first = context();
    const second = context({
      run: { id: 'run-concurrent', taskId: 'task-1', workerId: 'cli-worker', status: 'RUNNING' },
    });
    const [firstStart, secondStart] = await Promise.all([
      adapter.start(first),
      adapter.start(second),
    ]);
    expect([firstStart.type, secondStart.type].sort()).toEqual(['failed', 'started']);
    const startedContext = firstStart.type === 'started' ? first : second;
    const failedStart = firstStart.type === 'failed' ? firstStart : secondStart;
    expect(failedStart.failure?.message).toContain('concurrency limit');
    await adapter.cancel(startedContext, { requestedAt: new Date().toISOString() });
    await collect(adapter.stream(startedContext));
  }, 10_000);
});

describe('readConfinedRegularFile', () => {
  it('detects deterministic time-of-check/time-of-use replacement races', async () => {
    const workspaceRoot = workspace();
    const artifact = join(workspaceRoot, 'race.patch');
    const original = join(workspaceRoot, 'original.patch');
    writeFileSync(artifact, 'original');

    await expect(
      readConfinedRegularFile(workspaceRoot, 'race.patch', {
        maxBytes: 1024,
        allowBinary: false,
        hooks: {
          beforeOpen: () => {
            renameSync(artifact, original);
            writeFileSync(artifact, 'replacement');
          },
        },
      }),
    ).rejects.toThrow('replaced between inspection and open');
  });
});
