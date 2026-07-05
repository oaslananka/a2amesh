import { afterEach, describe, expect, it } from 'vitest';
import { A2AServer } from '../../packages/runtime/src/server/A2AServer.js';
import { A2AClient } from '../../packages/runtime/src/client/A2AClient.js';
import {
  CassetteRecorder,
  replayCassette,
} from '../../packages/runtime/src/testing/cassette/index.js';
import type { Artifact, Message, Task } from '../../packages/runtime/src/types/task.js';
import { createUserMessage, startTestServer, waitForTaskState } from './helpers.js';

class RecordableAgent extends A2AServer {
  constructor() {
    super({
      protocolVersion: '1.0',
      name: 'Recordable Agent',
      description: 'An agent whose task lifecycle is recorded to a cassette',
      url: 'http://localhost:0',
      version: '1.0.0',
    });
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const textPart = message.parts.find((part) => part.type === 'text');
    return [
      {
        artifactId: 'reply',
        parts: [{ type: 'text', text: `echo: ${textPart?.type === 'text' ? textPart.text : ''}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

describe('cassette record/replay against a real A2AServer', () => {
  const handles: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(handles.map((handle) => handle.close()));
    handles.length = 0;
  });

  it('replays a live-recorded task lifecycle LLM-free, byte-identical in structure', async () => {
    const server = new RecordableAgent();
    const handle = await startTestServer(server);
    handles.push(handle);

    const recorder = new CassetteRecorder({ redact: false });
    const unsubscribe = recorder.attach(server.getTaskManager());

    const client = new A2AClient(handle.url);
    const createdTask = await client.sendMessage({ message: createUserMessage('hello mesh') });
    const completedTask = await waitForTaskState(client, createdTask.id, ['COMPLETED']);
    unsubscribe();

    expect(completedTask.artifacts?.[0]?.parts[0]).toEqual({
      type: 'text',
      text: 'echo: hello mesh',
    });

    const cassette = recorder.toCassette();
    // The real server transitions to WORKING before calling the adapter, so
    // the recorded sequence has an intermediate 'state' entry the simpler
    // unit-level tests (which drive TaskManager directly) do not produce.
    expect(cassette.entries.map((entry) => entry.reason)).toEqual([
      'created',
      'message',
      'state',
      'artifact',
      'state',
    ]);

    const result = await replayCassette(cassette);

    expect(result.integrity).toEqual({ valid: true });
    expect(result.matches).toBe(true);
    expect(result.replayedEntries.at(-1)?.task.status.state).toBe('COMPLETED');
    expect(result.replayedEntries[3]?.task.artifacts?.[0]?.parts[0]).toEqual({
      type: 'text',
      text: 'echo: hello mesh',
    });
  });

  it('detects divergence when replayed against a changed adapter implementation', async () => {
    const server = new RecordableAgent();
    const handle = await startTestServer(server);
    handles.push(handle);

    const recorder = new CassetteRecorder({ redact: false });
    const unsubscribe = recorder.attach(server.getTaskManager());

    const client = new A2AClient(handle.url);
    const createdTask = await client.sendMessage({ message: createUserMessage('hello mesh') });
    await waitForTaskState(client, createdTask.id, ['COMPLETED']);
    unsubscribe();

    const cassette = recorder.toCassette();

    const result = await replayCassette(cassette, {
      handleTask: async () => [
        { artifactId: 'reply', parts: [{ type: 'text', text: 'a changed response' }], index: 0 },
      ],
    });

    expect(result.integrity.valid).toBe(true);
    expect(result.matches).toBe(false);
    expect(result.firstMismatchAt).toBe(3); // the 'artifact' entry
  });
});
