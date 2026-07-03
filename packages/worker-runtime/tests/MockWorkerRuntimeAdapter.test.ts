import { describe, expect, it } from 'vitest';
import { MockWorkerRuntimeAdapter } from '../src/adapters/MockWorkerRuntimeAdapter.js';
import type { WorkerRuntimeContext, WorkerRuntimeEvent } from '../src/types/lifecycle.js';

function context(overrides: Partial<WorkerRuntimeContext> = {}): WorkerRuntimeContext {
  return {
    task: {
      id: 'task-1',
      status: { state: 'WORKING', timestamp: '2026-07-03T00:00:00.000Z' },
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
    },
    worker: {
      id: 'mock-worker',
      card: {
        protocolVersion: '1.0',
        name: 'Mock',
        description: 'mock worker',
        url: 'http://mock.local',
        version: '1.0.0',
      },
      status: 'IDLE',
      lastSeenAt: '2026-07-03T00:00:00.000Z',
    },
    run: { id: 'run-1', taskId: 'task-1', workerId: 'mock-worker', status: 'RUNNING' },
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<WorkerRuntimeEvent>): Promise<WorkerRuntimeEvent[]> {
  const events: WorkerRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('MockWorkerRuntimeAdapter', () => {
  it('registers, advertises capabilities via its card, and completes a full lifecycle', async () => {
    const adapter = new MockWorkerRuntimeAdapter({
      id: 'mock-worker',
      card: {
        protocolVersion: '1.0',
        name: 'Mock',
        description: 'mock worker',
        url: 'http://mock.local',
        version: '1.0.0',
        fleetRoles: ['coding-agent'],
      },
      steps: [{ message: 'planning' }, { message: 'editing' }],
    });

    expect(adapter.card.fleetRoles).toContain('coding-agent');

    const ctx = context();
    const prepared = await adapter.prepare(ctx);
    expect(prepared.type).toBe('prepared');

    await adapter.start(ctx);
    const events = await collect(adapter.stream(ctx));
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'task-update',
      'task-update',
      'finalized',
    ]);

    const verification = await adapter.verify(ctx);
    expect(verification.status).toBe('PASSED');

    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('COMPLETED');

    const cleaned = await adapter.cleanup(ctx);
    expect(cleaned.type).toBe('cleaned-up');
  });

  it('streams progress and artifacts in order before finalizing', async () => {
    const artifact = {
      artifactId: 'a1',
      index: 0,
      parts: [{ type: 'text' as const, text: 'diff' }],
    };
    const adapter = new MockWorkerRuntimeAdapter({
      id: 'mock-worker',
      card: {
        protocolVersion: '1.0',
        name: 'Mock',
        description: 'mock',
        url: 'http://mock.local',
        version: '1.0.0',
      },
      steps: [{ message: 'generated patch', artifact }],
    });
    const ctx = context();
    await adapter.start(ctx);
    const events = await collect(adapter.stream(ctx));
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'artifact',
      'task-update',
      'finalized',
    ]);
    expect(events[1]?.artifact).toEqual(artifact);
  });

  it('reports structured failure without throwing when the run fails', async () => {
    const adapter = new MockWorkerRuntimeAdapter({
      id: 'mock-worker',
      card: {
        protocolVersion: '1.0',
        name: 'Mock',
        description: 'mock',
        url: 'http://mock.local',
        version: '1.0.0',
      },
      fail: true,
      failureMessage: 'simulated worker crash',
    });
    const ctx = context();
    await adapter.start(ctx);
    const events = await collect(adapter.stream(ctx));
    const failedEvent = events.at(-1);
    expect(failedEvent?.type).toBe('failed');
    expect(failedEvent?.failure).toEqual(
      expect.objectContaining({ code: 'UNKNOWN', message: 'simulated worker crash' }),
    );

    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('FAILED');
    const verification = await adapter.verify(ctx);
    expect(verification.status).toBe('FAILED');
  });

  it('supports cancellation mid-run and short-circuits remaining steps', async () => {
    const adapter = new MockWorkerRuntimeAdapter({
      id: 'mock-worker',
      card: {
        protocolVersion: '1.0',
        name: 'Mock',
        description: 'mock',
        url: 'http://mock.local',
        version: '1.0.0',
      },
      steps: [
        { message: 'step-1', delayMs: 5 },
        { message: 'step-2', delayMs: 50 },
      ],
    });
    const ctx = context();
    await adapter.start(ctx);
    const cancelEvent = await adapter.cancel(ctx, { requestedAt: new Date().toISOString() });
    expect(cancelEvent.type).toBe('canceled');
    const result = await adapter.finalize(ctx, { status: 'RUNNING' });
    expect(result.status).toBe('CANCELED');
  });
});
