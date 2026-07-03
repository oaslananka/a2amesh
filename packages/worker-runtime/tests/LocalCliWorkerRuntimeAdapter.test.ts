import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalCliWorkerRuntimeAdapter } from '../src/adapters/LocalCliWorkerRuntimeAdapter.js';
import type { WorkerRuntimeContext, WorkerRuntimeEvent } from '../src/types/lifecycle.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'a2amesh-cli-adapter-'));
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

describe('LocalCliWorkerRuntimeAdapter', () => {
  it('runs an allowlisted command in the scoped workspace and returns structured completion', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'node',
      buildArgs: () => ['-e', "console.log('hello from worker')"],
      policy: { commandAllowlist: ['node'], workspaceRoot },
    });
    const ctx = context();
    await adapter.start(ctx);
    const events = await collect(adapter.stream(ctx));
    expect(events.at(-1)?.type).toBe('finalized');
    expect(events.some((event) => event.message?.includes('hello from worker'))).toBe(true);

    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('COMPLETED');
  });

  it('blocks commands outside the allowlist with a structured policy-denied failure', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'rm',
      policy: { commandAllowlist: ['node'], workspaceRoot },
    });
    const ctx = context();
    const startEvent = await adapter.start(ctx);
    expect(startEvent.type).toBe('failed');
    expect(startEvent.failure).toEqual(expect.objectContaining({ code: 'POLICY_DENIED' }));
    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('FAILED');
  });

  it('blocks working directories that escape the workspace root', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'node',
      cwd: '../outside',
      policy: { commandAllowlist: ['node'], workspaceRoot },
    });
    const ctx = context();
    const startEvent = await adapter.start(ctx);
    expect(startEvent.type).toBe('failed');
    expect(startEvent.failure?.message).toContain('escapes workspace root');
  });

  it('does not forward ambient environment variables outside the allowlist', async () => {
    const workspaceRoot = workspace();
    process.env['A2AMESH_TEST_SECRET'] = 'super-secret-value';
    try {
      const adapter = new LocalCliWorkerRuntimeAdapter({
        id: 'cli-worker',
        card,
        command: 'node',
        buildArgs: () => ['-e', 'console.log(JSON.stringify(process.env))'],
        policy: { commandAllowlist: ['node'], workspaceRoot, envAllowlist: [] },
      });
      const ctx = context();
      await adapter.start(ctx);
      const events = await collect(adapter.stream(ctx));
      const combined = events.map((event) => event.message).join('\n');
      expect(combined).not.toContain('super-secret-value');
    } finally {
      delete process.env['A2AMESH_TEST_SECRET'];
    }
  });

  it('aborts and reports a timeout when the process exceeds the configured limit', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'node',
      buildArgs: () => ['-e', 'setTimeout(() => {}, 5000)'],
      policy: { commandAllowlist: ['node'], workspaceRoot, timeoutMs: 50 },
    });
    const ctx = context();
    await adapter.start(ctx);
    const events = await collect(adapter.stream(ctx));
    const failedEvent = events.at(-1);
    expect(failedEvent?.type).toBe('failed');
    expect(failedEvent?.failure).toEqual(
      expect.objectContaining({ code: 'TIMEOUT', retryable: true }),
    );
  }, 10_000);

  it('supports cancellation of an in-flight run', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'node',
      buildArgs: () => ['-e', 'setTimeout(() => {}, 5000)'],
      policy: { commandAllowlist: ['node'], workspaceRoot, timeoutMs: 10_000 },
    });
    const ctx = context();
    await adapter.start(ctx);
    await adapter.cancel(ctx, {
      requestedAt: new Date().toISOString(),
      reason: 'operator canceled',
    });
    const events = await collect(adapter.stream(ctx));
    const lastEvent = events.at(-1);
    expect(lastEvent?.type).toBe('canceled');
    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('CANCELED');
  }, 10_000);

  it('captures declared output files as checksummed artifacts', async () => {
    const workspaceRoot = workspace();
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'node',
      buildArgs: () => ['-e', "require('node:fs').writeFileSync('out.patch', 'diff --git a b')"],
      artifactFiles: () => ['out.patch'],
      policy: { commandAllowlist: ['node'], workspaceRoot },
    });
    const ctx = context();
    await adapter.start(ctx);
    await collect(adapter.stream(ctx));
    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('COMPLETED');
    expect(result.artifacts?.[0]?.name).toBe('out.patch');
    expect(result.artifacts?.[0]?.metadata?.['checksumSha256']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('denies runs beyond the configured concurrency limit', async () => {
    const workspaceRoot = workspace();
    writeFileSync(join(workspaceRoot, 'marker.txt'), 'ok');
    const adapter = new LocalCliWorkerRuntimeAdapter({
      id: 'cli-worker',
      card,
      command: 'node',
      buildArgs: () => ['-e', 'setTimeout(() => {}, 300)'],
      policy: {
        commandAllowlist: ['node'],
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
});
