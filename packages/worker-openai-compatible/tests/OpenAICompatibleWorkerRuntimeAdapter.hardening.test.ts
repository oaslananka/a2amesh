import { describe, expect, it, vi } from 'vitest';
import type { WorkerCard } from '@a2amesh/internal-fleet';
import type { WorkerRuntimeContext, WorkerRuntimeEvent } from '@a2amesh/internal-worker-runtime';
import {
  OpenAICompatibleWorkerRuntimeAdapter,
  type OpenAICompatibleChatCompletionResponse,
  type OpenAICompatibleWorkerClient,
  type OpenAICompatibleWorkerRuntimeConfig,
} from '../src/index.js';

const card: WorkerCard = {
  protocolVersion: '1.0',
  name: 'OpenAI-compatible worker',
  description: 'Executes bounded text inference through a documented provider API.',
  url: 'https://worker.example.com',
  version: '1.0.0',
  fleetRoles: ['model-worker'],
};

function context(runId: string, description = 'Summarize release evidence.'): WorkerRuntimeContext {
  return {
    task: {
      id: `task-${runId}`,
      description,
      status: { state: 'WORKING', timestamp: '2026-08-02T00:00:00.000Z' },
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
    worker: {
      id: 'provider-worker',
      card,
      status: 'IDLE',
      lastSeenAt: '2026-08-02T00:00:00.000Z',
    },
    run: {
      id: runId,
      taskId: `task-${runId}`,
      workerId: 'provider-worker',
      status: 'RUNNING',
    },
  };
}

async function collect(stream: AsyncIterable<WorkerRuntimeEvent>): Promise<WorkerRuntimeEvent[]> {
  const events: WorkerRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function pendingClient(): OpenAICompatibleWorkerClient {
  return {
    chat: {
      completions: {
        create: vi.fn(
          (_request, options) =>
            new Promise<OpenAICompatibleChatCompletionResponse>((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
                once: true,
              });
            }),
        ),
      },
    },
  };
}

function adapter(
  client: OpenAICompatibleWorkerClient,
  overrides: Partial<OpenAICompatibleWorkerRuntimeConfig> = {},
): OpenAICompatibleWorkerRuntimeAdapter {
  return new OpenAICompatibleWorkerRuntimeAdapter({
    id: 'provider-worker',
    card,
    providerId: 'documented-provider',
    model: 'provider/model-small',
    client,
    ...overrides,
  });
}

describe('OpenAICompatibleWorkerRuntimeAdapter hardening', () => {
  it('treats repeated start calls for the same run as idempotent', async () => {
    const client = pendingClient();
    const worker = adapter(client, { policy: { timeoutMs: 5_000 } });
    const ctx = context('duplicate-start');

    const first = await worker.start(ctx);
    const second = await worker.start(ctx);

    expect(first.type).toBe('started');
    expect(second).toBe(first);
    await vi.waitFor(() => expect(client.chat.completions.create).toHaveBeenCalledOnce());

    const canceled = await worker.cancel(ctx, {
      requestedAt: '2026-08-02T00:00:01.000Z',
      reason: 'test cleanup',
    });
    expect(canceled.type).toBe('canceled');
    expect((await collect(worker.stream(ctx))).at(-1)?.type).toBe('canceled');
  });

  it('does not reuse a run id across different tasks', async () => {
    const client = pendingClient();
    const worker = adapter(client, { policy: { timeoutMs: 5_000 } });
    const first = context('bound-run');
    const conflicting = context('bound-run', 'Different task payload.');
    conflicting.task.id = 'different-task';
    conflicting.run.taskId = 'different-task';

    await worker.start(first);
    const event = await worker.start(conflicting);

    expect(event).toMatchObject({
      type: 'failed',
      failure: { code: 'POLICY_DENIED', retryable: false },
    });
    expect(client.chat.completions.create).toHaveBeenCalledOnce();
    await worker.cancel(first, {
      requestedAt: '2026-08-02T00:00:01.000Z',
      reason: 'test cleanup',
    });
    await collect(worker.stream(first));
  });

  it('rejects combined system and task prompts beyond the configured input boundary', async () => {
    const client = pendingClient();
    const worker = adapter(client, {
      systemPrompt: 'fixed',
      policy: { maxPromptCharacters: 10 },
    });
    const ctx = context('prompt-limit', 'response');

    const event = await worker.prepare(ctx);

    expect(event).toMatchObject({
      type: 'failed',
      failure: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: expect.stringContaining('prompt'),
        retryable: false,
      },
    });
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('rejects invalid prompt limits during construction', () => {
    expect(() =>
      adapter(pendingClient(), {
        policy: { maxPromptCharacters: 0 },
      }),
    ).toThrow(/maxPromptCharacters/);
  });
});
