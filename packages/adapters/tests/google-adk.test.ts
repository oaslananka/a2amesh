import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleADKAdapter } from '../src/google-adk/GoogleADKAdapter.js';
import type { AnyAgentCard, Message, Task } from '@a2amesh/runtime';
import { runAdapterContract } from './contracts/adapterContract.js';

function createGoogleADKContractInstance(
  card: AnyAgentCard,
  responseText = 'google adk contract response',
  apiKey?: string,
) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ output: responseText, metadata: { requestId: 'contract' } }), {
      status: 200,
    }),
  );

  return {
    adapter: new GoogleADKAdapter(card, 'https://example.com/adk', apiKey),
    context: { fetchMock },
  };
}

describe('GoogleADKAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  runAdapterContract({
    adapterName: 'GoogleADKAdapter',
    provider: 'google-adk',
    compatibility: 'beta',
    supportsStreaming: false,
    expectedText: 'google adk contract response',
    createInstance: (card) => createGoogleADKContractInstance(card),
    createProviderErrorCase: (card) => {
      const instance = createGoogleADKContractInstance(card);
      instance.context.fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }));
      return { instance, expectedError: /Google ADK request failed with status 400/ };
    },
    assertProviderRequest: ({ context }) => {
      const [, init] = context.fetchMock.mock.calls[0] ?? [];
      const body = JSON.parse(String(init?.body)) as {
        taskId: string;
        contextId: string;
        message: string;
        history: Array<{ role: string; content: string }>;
      };

      expect(init).toEqual(
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'contract-task',
          },
        }),
      );
      expect(body).toEqual({
        taskId: 'contract-task',
        contextId: 'contract-context',
        message: 'contract current',
        history: [
          { role: 'user', content: 'previous user' },
          { role: 'model', content: 'previous agent' },
        ],
      });
    },
    authPropagationCase: {
      createInstance: (card) =>
        createGoogleADKContractInstance(card, 'google auth response', 'secret-key'),
      assertAuthPropagation: ({ context }) => {
        const [, init] = context.fetchMock.mock.calls[0] ?? [];
        expect(init?.headers).toEqual({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'contract-task',
          'x-goog-api-key': 'secret-key',
        });
      },
    },
  });

  it('maps HTTP JSON responses into artifacts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ output: 'google adk' }), { status: 200 }),
    );

    const card: AnyAgentCard = {
      protocolVersion: '1.0',
      name: 'ADK',
      description: 'desc',
      url: 'http://test',
      version: '1.0',
    };
    const adapter = new GoogleADKAdapter(card, 'https://example.com/adk');
    const task: Task = {
      id: 'task-1',
      status: { state: 'WORKING', timestamp: '' },
      history: [],
    };
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
      messageId: 'msg-1',
      timestamp: '',
    };

    const artifacts = await adapter.handleTask(task, message);
    expect(artifacts[0]?.parts[0]).toEqual({ type: 'text', text: 'google adk' });
  });

  it('maps event-stream responses into artifacts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: hello\ndata: world\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const card: AnyAgentCard = {
      protocolVersion: '1.0',
      name: 'ADK',
      description: 'desc',
      url: 'http://test',
      version: '1.0',
    };
    const adapter = new GoogleADKAdapter(card, 'https://example.com/adk');
    const task: Task = {
      id: 'task-1',
      status: { state: 'WORKING', timestamp: '' },
      history: [],
    };
    const message: Message = {
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
      messageId: 'msg-1',
      timestamp: '',
    };

    const artifacts = await adapter.handleTask(task, message);
    expect(artifacts[0]?.parts[0]).toEqual({ type: 'text', text: 'hello\nworld' });
    const metadata = (artifacts[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata;
    expect(metadata).toMatchObject({
      sourceTransport: 'sse',
      buffered: true,
    });
    expect(metadata?.['contract']).toMatchObject({
      streamed: false,
      supportsStreaming: false,
    });
  });
});
