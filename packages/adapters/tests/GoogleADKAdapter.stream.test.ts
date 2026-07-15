import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleADKAdapter } from '../src/google-adk/GoogleADKAdapter.js';
import * as a2aWarp from '@a2amesh/runtime';

vi.mock('@a2amesh/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof a2aWarp>();
  return {
    ...actual,
    validateAndFetch: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() },
  };
});

describe('GoogleADKAdapter Stream Parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly parses fragmented SSE chunks split across newlines', async () => {
    const adapter = new GoogleADKAdapter(
      {
        protocolVersion: '1.0',
        name: 'TestADK',
        description: 'test',
        url: 'http://test',
        version: '1.0.0',
      },
      'http://test-adk.com/api',
    );

    // Simulate a stream reader that yields fragmented chunks.
    // The chunk is split right in the middle of the "data: " line.
    const chunk1 = 'data: {"text":"Hello"}\n\nda';
    const chunk2 = 'ta: {"text":" World"}\n\ndata: {"text":"!"}\n\n';

    const chunks = [chunk1, chunk2];
    let chunkIndex = 0;

    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIndex < chunks.length) {
          const value = new TextEncoder().encode(chunks[chunkIndex]);
          chunkIndex++;
          return Promise.resolve({ value, done: false });
        }
        return Promise.resolve({ value: undefined, done: true });
      }),
    };

    const mockResponse = {
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader: () => mockReader },
    };

    vi.mocked(a2aWarp.validateAndFetch).mockResolvedValue(mockResponse as any);

    const task: a2aWarp.Task = {
      id: 'task-1',
      contextId: 'ctx-1',
      status: { state: 'QUEUED', timestamp: new Date().toISOString() },
      history: [],
    };

    const artifacts = await adapter.handleTask(task, {
      role: 'user',
      parts: [{ type: 'text', text: 'Hi' }],
      messageId: 'msg-1',
      timestamp: new Date().toISOString(),
    });

    expect(artifacts).toHaveLength(1);
    const firstArtifact = artifacts[0];
    if (!firstArtifact) {
      throw new Error('Expected one artifact');
    }
    const firstPart = firstArtifact.parts[0];
    if (!firstPart || firstPart.type !== 'text') {
      throw new Error('Expected a text artifact');
    }
    const resultText = firstPart.text;

    // We expect the chunks to be fully reconstructed, omitting the "data: " prefix.
    expect(resultText).toContain('{"text":"Hello"}');
    expect(resultText).toContain('{"text":" World"}');
    expect(resultText).toContain('{"text":"!"}');
  });
});
