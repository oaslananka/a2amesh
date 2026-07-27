import { describe, expect, it } from 'vitest';
import { createTextArtifact, extractRequiredText, extractText } from '../src/custom/contract.js';
import type { Part, Task } from '@a2amesh/runtime';

const baseTask: Task = {
  kind: 'task',
  id: 'task-1',
  contextId: 'context-1',
  status: { state: 'WORKING', timestamp: '2026-01-01T00:00:00.000Z' },
  history: [],
  artifacts: [],
};

describe('adapter contract helpers', () => {
  it('extracts text parts in order and rejects non-text-only inputs', () => {
    const parts: Part[] = [
      { type: 'text', text: 'first' },
      { type: 'data', data: { ignored: true } },
      { type: 'text', text: 'second' },
    ];

    expect(extractText(parts)).toBe('first\nsecond');
    expect(extractRequiredText(parts, 'Provider')).toBe('first\nsecond');
    expect(() =>
      extractRequiredText([{ type: 'data', data: { empty: true } }], 'Provider'),
    ).toThrow(
      expect.objectContaining({
        code: 'UNSUPPORTED_INPUT',
        message: 'Provider adapter requires text input',
      }),
    );
  });

  it('creates protocol artifacts with stable provider contract metadata', () => {
    const artifact = createTextArtifact(baseTask, {
      artifactId: 'artifact-1',
      name: 'response',
      description: 'Provider response',
      text: 'hello',
      provider: 'Provider',
      compatibility: 'stable',
      model: 'model-1',
      streamed: false,
      supportsStreaming: true,
      extensions: ['urn:extension'],
      metadata: { requestId: 'request-1' },
    });

    expect(artifact).toEqual({
      artifactId: 'artifact-1',
      name: 'response',
      description: 'Provider response',
      parts: [{ type: 'text', text: 'hello' }],
      index: 0,
      lastChunk: true,
      metadata: {
        requestId: 'request-1',
        provider: 'Provider',
        model: 'model-1',
        taskId: 'task-1',
        contextId: 'context-1',
        contract: {
          provider: 'Provider',
          compatibility: 'stable',
          supportsStreaming: true,
          supportsCancellation: false,
          outputType: 'text',
          streamed: false,
        },
      },
      extensions: ['urn:extension'],
    });
  });

  it('omits optional streamed, extension, model and context metadata when absent', () => {
    const taskWithoutContext: Task = {
      kind: 'task',
      id: 'task-without-context',
      status: baseTask.status,
      history: [],
      artifacts: [],
    };
    const artifact = createTextArtifact(taskWithoutContext, {
      artifactId: 'artifact-minimal',
      name: 'minimal',
      text: 'hello',
      provider: 'Provider',
      compatibility: 'beta',
      supportsStreaming: false,
    });

    expect(artifact).not.toHaveProperty('description');
    expect(artifact).not.toHaveProperty('extensions');
    const metadata = 'metadata' in artifact ? artifact.metadata : undefined;
    expect(metadata).toBeDefined();
    expect(metadata).not.toHaveProperty('model');
    expect(metadata).not.toHaveProperty('contextId');
    const contract = metadata?.['contract'];
    expect(contract).not.toHaveProperty('streamed');
    expect(contract).toEqual({
      provider: 'Provider',
      compatibility: 'beta',
      supportsStreaming: false,
      supportsCancellation: false,
      outputType: 'text',
    });
  });
});
