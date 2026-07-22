import { describe, expect, it } from 'vitest';
import type { Artifact, Message, Task } from '@a2amesh/runtime';
import { BaseAdapter } from '../src/BaseAdapter.js';
import { createTextArtifact, extractRequiredText, extractText } from '../src/contract.js';

const task: Task = {
  id: 'task-1',
  contextId: 'context-1',
  status: { state: 'WORKING', timestamp: '2026-07-22T00:00:00.000Z' },
  history: [],
};

class TestAdapter extends BaseAdapter {
  override async handleTask(_task: Task, _message: Message): Promise<Artifact[]> {
    return [];
  }
}

describe('adapter base contract', () => {
  it('normalizes text input and rejects unsupported parts', () => {
    const parts = [
      { type: 'text' as const, text: 'first' },
      { type: 'data' as const, data: { ignored: true } },
      { type: 'text' as const, text: 'second' },
    ];
    expect(extractText(parts)).toBe('first\nsecond');
    expect(extractRequiredText(parts, 'test')).toBe('first\nsecond');
    expect(() => extractRequiredText([{ type: 'data', data: {} }], 'test')).toThrow(
      'test adapter requires text input',
    );
  });

  it('creates a context-aware text artifact with contract metadata', () => {
    expect(
      createTextArtifact(task, {
        artifactId: 'artifact-1',
        name: 'answer',
        description: 'Provider response',
        text: 'hello',
        provider: 'test',
        compatibility: 'stable',
        model: 'model-1',
        streamed: true,
        supportsStreaming: true,
        supportsCancellation: true,
        extensions: ['urn:test'],
        metadata: { requestId: 'request-1' },
      }),
    ).toEqual(
      expect.objectContaining({
        artifactId: 'artifact-1',
        description: 'Provider response',
        parts: [{ type: 'text', text: 'hello' }],
        extensions: ['urn:test'],
        metadata: expect.objectContaining({
          requestId: 'request-1',
          provider: 'test',
          model: 'model-1',
          taskId: 'task-1',
          contextId: 'context-1',
          contract: {
            provider: 'test',
            compatibility: 'stable',
            supportsStreaming: true,
            supportsCancellation: true,
            outputType: 'text',
            streamed: true,
          },
        }),
      }),
    );
  });

  it('constructs an A2A server adapter from a legacy card', async () => {
    const adapter = new TestAdapter({
      protocolVersion: '0.3',
      name: 'legacy',
      description: 'legacy adapter',
      url: 'https://legacy.example.com',
      version: '0.3.0',
    });
    expect(adapter).toBeInstanceOf(BaseAdapter);
    await adapter.stop();
  });
});
