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

function context(overrides: Partial<WorkerRuntimeContext> = {}): WorkerRuntimeContext {
  return {
    task: {
      id: 'task-1',
      description: 'Summarize the verified release evidence.',
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
      id: `run-${Math.random().toString(36).slice(2)}`,
      taskId: 'task-1',
      workerId: 'provider-worker',
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

function adapter(
  client: OpenAICompatibleWorkerClient,
  overrides: Partial<OpenAICompatibleWorkerRuntimeConfig> = {},
) {
  return new OpenAICompatibleWorkerRuntimeAdapter({
    id: 'provider-worker',
    card,
    providerId: 'nvidia-nim',
    model: 'provider/model-free',
    systemPrompt: 'Return only verified conclusions.',
    maxTokens: 512,
    temperature: 0.1,
    client,
    ...overrides,
  });
}

function successfulClient(text = 'Verified summary'): OpenAICompatibleWorkerClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
      },
    },
  };
}

describe('OpenAICompatibleWorkerRuntimeAdapter', () => {
  it('executes the full worker lifecycle through the injected official API client', async () => {
    const client = successfulClient();
    const worker = adapter(client);
    const ctx = context();

    expect((await worker.prepare(ctx)).type).toBe('prepared');
    expect((await worker.start(ctx)).type).toBe('started');
    const events = await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });
    const verification = await worker.verify(ctx);

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      {
        model: 'provider/model-free',
        messages: [
          { role: 'system', content: 'Return only verified conclusions.' },
          { role: 'user', content: 'Summarize the verified release evidence.' },
        ],
        max_tokens: 512,
        temperature: 0.1,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'task-update',
      'artifact',
      'usage',
      'finalized',
    ]);
    expect(result.status).toBe('COMPLETED');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
    expect(result.artifacts?.[0]).toEqual(
      expect.objectContaining({
        name: 'OpenAI-compatible provider response',
        parts: [{ type: 'text', text: 'Verified summary' }],
        metadata: expect.objectContaining({
          providerId: 'nvidia-nim',
          model: 'provider/model-free',
          integrationSurface: 'official-api',
          checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(verification.status).toBe('PASSED');
    expect((await worker.cleanup(ctx)).type).toBe('cleaned-up');
  });

  it('supports the minimal request shape without optional prompt, settings, or usage', async () => {
    const client: OpenAICompatibleWorkerClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Minimal result' } }],
            usage: {},
          }),
        },
      },
    };
    const worker = new OpenAICompatibleWorkerRuntimeAdapter({
      id: 'provider-worker',
      card,
      providerId: 'nvidia-nim',
      model: 'provider/model-free',
      client,
    });
    const ctx = context();

    await worker.start(ctx);
    const events = await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });

    expect(client.chat.completions.create).toHaveBeenCalledWith(
      {
        model: 'provider/model-free',
        messages: [{ role: 'user', content: 'Summarize the verified release evidence.' }],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'task-update',
      'artifact',
      'finalized',
    ]);
    expect(result.usage).toBeUndefined();
  });

  it('rejects a mismatched worker identity and an empty task description', async () => {
    const worker = adapter(successfulClient());
    const wrongWorker = context({
      worker: {
        id: 'other-worker',
        card,
        status: 'IDLE',
        lastSeenAt: '2026-08-02T00:00:00.000Z',
      },
    });
    const missingDescription = context({
      task: {
        id: 'task-empty',
        description: '   ',
        status: { state: 'WORKING', timestamp: '2026-08-02T00:00:00.000Z' },
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    });

    expect((await worker.prepare(wrongWorker)).failure?.code).toBe('POLICY_DENIED');
    expect((await worker.prepare(missingDescription)).failure?.code).toBe('CAPABILITY_UNAVAILABLE');
  });

  it('rejects an already-expired deadline before invoking the provider', async () => {
    const client = successfulClient();
    const worker = adapter(client);
    const event = await worker.start(context({ deadlineAt: '2000-01-01T00:00:00.000Z' }));

    expect(event.failure).toEqual(expect.objectContaining({ code: 'TIMEOUT', retryable: false }));
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'POLICY_DENIED', false],
    [403, 'POLICY_DENIED', false],
    [503, 'WORKER_UNAVAILABLE', true],
    [418, 'UNKNOWN', false],
  ] as const)(
    'classifies provider HTTP %s failures without leaking provider text',
    async (status, code, retryable) => {
      const client: OpenAICompatibleWorkerClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue({
              status,
              message: 'token=private-provider-value',
            }),
          },
        },
      };
      const worker = adapter(client);
      const ctx = context();

      await worker.start(ctx);
      const events = await collect(worker.stream(ctx));
      const failure = events.at(-1)?.failure;

      expect(failure).toEqual(expect.objectContaining({ code, retryable, details: { status } }));
      expect(failure?.message).not.toContain('private-provider-value');
    },
  );

  it('classifies an unstructured provider failure without echoing it', async () => {
    const client: OpenAICompatibleWorkerClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue('raw provider secret text'),
        },
      },
    };
    const worker = adapter(client);
    const ctx = context();

    await worker.start(ctx);
    const events = await collect(worker.stream(ctx));

    expect(events.at(-1)?.failure).toEqual(
      expect.objectContaining({ code: 'UNKNOWN', message: 'Provider request failed.' }),
    );
  });

  it('rejects provider output beyond the configured artifact boundary', async () => {
    const worker = adapter(successfulClient('response-too-large'), {
      policy: { maxOutputCharacters: 5 },
    });
    const ctx = context();

    await worker.start(ctx);
    const events = await collect(worker.stream(ctx));

    expect(events.at(-1)?.failure).toEqual(
      expect.objectContaining({ code: 'ARTIFACT_UNAVAILABLE', retryable: false }),
    );
  });

  it('reports skipped verification during a live run and failed verification after failure', async () => {
    const pendingClient: OpenAICompatibleWorkerClient = {
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
    const worker = adapter(pendingClient, { policy: { timeoutMs: 5_000 } });
    const ctx = context();

    await worker.start(ctx);
    expect((await worker.observe(ctx)).type).toBe('task-update');
    expect((await worker.verify(ctx)).status).toBe('SKIPPED');
    await worker.cancel(ctx, {
      requestedAt: '2026-08-02T00:00:01.000Z',
      requestedBy: 'operator',
    });
    await collect(worker.stream(ctx));
    expect((await worker.verify(ctx)).status).toBe('FAILED');
    expect((await worker.cancel(ctx, { requestedAt: '2026-08-02T00:00:02.000Z' })).type).toBe(
      'canceled',
    );
  });

  it('cleans up absent and active run state without leaving a live request', async () => {
    const pendingClient: OpenAICompatibleWorkerClient = {
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
    const worker = adapter(pendingClient, { policy: { timeoutMs: 5_000 } });
    const absent = context();
    expect((await worker.cleanup(absent)).type).toBe('cleaned-up');

    const active = context();
    await worker.start(active);
    expect((await worker.cleanup(active)).type).toBe('cleaned-up');
    expect(() => worker.stream(active)).toThrow(/No provider run exists/);
  });

  it.each([
    [{ id: '   ' }, /worker id/],
    [{ providerId: '   ' }, /provider id/],
    [{ model: '   ' }, /model/],
    [{ maxTokens: 0 }, /maxTokens/],
    [{ temperature: -1 }, /temperature/],
    [{ temperature: 3 }, /temperature/],
    [{ policy: { timeoutMs: 0 } }, /policy\.timeoutMs/],
    [{ policy: { maxConcurrentRuns: 0 } }, /policy\.maxConcurrentRuns/],
    [{ policy: { maxOutputCharacters: 0 } }, /policy\.maxOutputCharacters/],
  ] as const)('rejects invalid worker configuration %j', (overrides, expected) => {
    expect(() => adapter(successfulClient(), overrides)).toThrow(expected);
  });

  it('fails closed when the requested side-effect level is not read-only', async () => {
    const client = successfulClient();
    const worker = adapter(client);
    const event = await worker.prepare(context({ metadata: { sideEffectLevel: 'remote-write' } }));

    expect(event.type).toBe('failed');
    expect(event.failure).toEqual(
      expect.objectContaining({ code: 'POLICY_DENIED', retryable: false }),
    );
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('rejects tool execution because the worker is text-inference only', async () => {
    const worker = adapter(successfulClient());
    const event = await worker.prepare(
      context({ metadata: { requestedProviderTools: ['shell'] } }),
    );

    expect(event.type).toBe('failed');
    expect(event.failure).toEqual(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE', retryable: false }),
    );
  });

  it('classifies provider rate limits without exposing provider error text', async () => {
    const client: OpenAICompatibleWorkerClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({
            status: 429,
            message: 'api_key=secret-value provider quota exceeded',
          }),
        },
      },
    };
    const worker = adapter(client);
    const ctx = context();

    await worker.start(ctx);
    const events = await collect(worker.stream(ctx));
    const failure = events.at(-1)?.failure;

    expect(failure).toEqual(
      expect.objectContaining({ code: 'WORKER_UNAVAILABLE', retryable: true }),
    );
    expect(failure?.message).not.toContain('secret-value');
    expect((await worker.finalize(ctx, { status: 'RUNNING' })).status).toBe('FAILED');
  });

  it('aborts a provider request after the bounded timeout', async () => {
    const client: OpenAICompatibleWorkerClient = {
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
    const worker = adapter(client, { policy: { timeoutMs: 20 } });
    const ctx = context();

    await worker.start(ctx);
    const events = await collect(worker.stream(ctx));

    expect(events.at(-1)?.failure).toEqual(
      expect.objectContaining({ code: 'TIMEOUT', retryable: true }),
    );
  });

  it('supports operator cancellation of an in-flight request', async () => {
    const client: OpenAICompatibleWorkerClient = {
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
    const worker = adapter(client, { policy: { timeoutMs: 5_000 } });
    const ctx = context();

    await worker.start(ctx);
    const canceled = await worker.cancel(ctx, {
      requestedAt: '2026-08-02T00:00:01.000Z',
      requestedBy: 'operator',
      reason: 'operator canceled provider inference',
    });
    const events = await collect(worker.stream(ctx));

    expect(canceled.type).toBe('canceled');
    expect(events.at(-1)?.type).toBe('canceled');
    expect((await worker.finalize(ctx, { status: 'RUNNING' })).status).toBe('CANCELED');
  });

  it('enforces the configured per-worker concurrency limit', async () => {
    const client: OpenAICompatibleWorkerClient = {
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
    const worker = adapter(client, {
      policy: { maxConcurrentRuns: 1, timeoutMs: 5_000 },
    });
    const first = context();
    const second = context();

    expect((await worker.start(first)).type).toBe('started');
    const rejected = await worker.start(second);
    expect(rejected.failure).toEqual(
      expect.objectContaining({ code: 'WORKER_UNAVAILABLE', retryable: true }),
    );

    await worker.cancel(first, {
      requestedAt: '2026-08-02T00:00:01.000Z',
      requestedBy: 'operator',
    });
    await collect(worker.stream(first));
  });

  it('fails when the provider returns no usable text artifact', async () => {
    const worker = adapter(successfulClient(''));
    const ctx = context();

    await worker.start(ctx);
    const events = await collect(worker.stream(ctx));

    expect(events.at(-1)?.failure).toEqual(
      expect.objectContaining({ code: 'ARTIFACT_UNAVAILABLE', retryable: false }),
    );
  });
});
