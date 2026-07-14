import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrewAIAdapter } from '../src/CrewAIAdapter.js';
import type { AnyAgentCard, Message, Task } from '@a2amesh/runtime';
import { runAdapterContract } from './contracts/adapterContract.js';

function createCrewAIContractInstance(
  card: AnyAgentCard,
  responseText = 'crewai contract response',
) {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ output: responseText, metadata: { requestId: 'contract' } }), {
      status: 200,
    }),
  );

  return {
    adapter: new CrewAIAdapter(card, 'https://example.com/bridge', {
      outboundPolicy: { allowedHostnames: ['example.com'] },
    }),
    context: { fetchMock },
  };
}

describe('CrewAIAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  runAdapterContract({
    adapterName: 'CrewAIAdapter',
    provider: 'crewai',
    compatibility: 'beta',
    supportsStreaming: false,
    expectedText: 'crewai contract response',
    createInstance: (card) => createCrewAIContractInstance(card),
    createProviderErrorCase: (card) => {
      const instance = createCrewAIContractInstance(card);
      instance.context.fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }));
      return { instance, expectedError: /CrewAI bridge failed with status 400/ };
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
          { role: 'agent', content: 'previous agent' },
        ],
      });
    },
  });

  it('maps bridge JSON responses into artifacts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ output: 'crewai response' }), { status: 200 }),
    );

    const card: AnyAgentCard = {
      protocolVersion: '1.0',
      name: 'Crew',
      description: 'desc',
      url: 'http://test',
      version: '1.0',
    };
    const adapter = new CrewAIAdapter(card, 'https://example.com/bridge', {
      outboundPolicy: { allowedHostnames: ['example.com'] },
    });
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
    expect(artifacts[0]?.parts[0]).toEqual({ type: 'text', text: 'crewai response' });
  });

  it('rejects local bridge endpoints unless explicitly allowed', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ output: 'unexpected' }), { status: 200 }));

    const card: AnyAgentCard = {
      protocolVersion: '1.0',
      name: 'Crew',
      description: 'desc',
      url: 'http://test',
      version: '1.0',
    };
    const adapter = new CrewAIAdapter(card, 'http://127.0.0.1/bridge');
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

    await expect(adapter.handleTask(task, message)).rejects.toThrow(/not allowed|private/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
