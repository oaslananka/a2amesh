import { describe, expect, it } from 'vitest';
import { InMemoryTaskStorage } from '../src/storage/InMemoryTaskStorage.js';
import { TaskManager } from '../src/server/TaskManager.js';
import {
  CassetteRecorder,
  replayCassette,
  verifyCassetteIntegrity,
} from '../src/testing/cassette/index.js';
import type { Message, ExtensibleArtifact, Artifact, Task } from '../src/types/task.js';

function textMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: 'message-1',
    timestamp: '2026-07-05T00:00:00.000Z',
  };
}

function textArtifact(text: string): ExtensibleArtifact {
  return {
    artifactId: 'artifact-1',
    parts: [{ type: 'text', text }],
    index: 0,
    lastChunk: true,
  };
}

function recordCompletedTask(prompt: string, response: string) {
  const taskManager = new TaskManager(new InMemoryTaskStorage());
  const recorder = new CassetteRecorder({ redact: false });
  const unsubscribe = recorder.attach(taskManager);

  const task = taskManager.createTask('session-1', 'context-1');
  taskManager.addHistoryMessage(task.id, textMessage(prompt));
  taskManager.addArtifact(task.id, textArtifact(response));
  taskManager.updateTaskState(task.id, 'COMPLETED');
  unsubscribe();

  return recorder.toCassette();
}

function recordFailedTask(prompt: string) {
  const taskManager = new TaskManager(new InMemoryTaskStorage());
  const recorder = new CassetteRecorder({ redact: false });
  const unsubscribe = recorder.attach(taskManager);

  const task = taskManager.createTask();
  taskManager.addHistoryMessage(task.id, textMessage(prompt));
  taskManager.updateTaskState(task.id, 'FAILED');
  unsubscribe();

  return recorder.toCassette();
}

describe('replayCassette', () => {
  it('reproduces an identical (LLM-free) state-transition sequence for a completed task', async () => {
    const cassette = recordCompletedTask('hello', 'world');

    const result = await replayCassette(cassette);

    expect(result.integrity).toEqual({ valid: true });
    expect(result.matches).toBe(true);
    expect(result.replayedEntries.map((entry) => entry.reason)).toEqual([
      'created',
      'message',
      'artifact',
      'state',
    ]);
    expect(result.replayedEntries.at(-1)?.task.status.state).toBe('COMPLETED');
  });

  it('reproduces an identical sequence for a task that ended in FAILED with no artifacts', async () => {
    const cassette = recordFailedTask('hello');

    const result = await replayCassette(cassette);

    expect(result.matches).toBe(true);
    expect(result.replayedEntries.map((entry) => entry.reason)).toEqual([
      'created',
      'message',
      'state',
    ]);
    expect(result.replayedEntries.at(-1)?.task.status.state).toBe('FAILED');
  });

  it('replays against a caller-supplied handler instead of the recorded artifacts', async () => {
    const cassette = recordCompletedTask('hello', 'original response');

    const handleTask = async (_task: Task, _message: Message): Promise<Artifact[]> => [
      textArtifact('original response'),
    ];
    const result = await replayCassette(cassette, { handleTask });

    expect(result.matches).toBe(true);
  });

  it('reports the first mismatch when a caller-supplied handler diverges from the recording', async () => {
    const cassette = recordCompletedTask('hello', 'original response');

    const handleTask = async (_task: Task, _message: Message): Promise<Artifact[]> => [
      textArtifact('a different response'),
    ];
    const result = await replayCassette(cassette, { handleTask });

    expect(result.matches).toBe(false);
    expect(result.firstMismatchAt).toBe(2); // the 'artifact' entry
  });

  it('fails fast on integrity when replaying a hand-tampered cassette', async () => {
    const cassette = recordCompletedTask('hello', 'world');
    cassette.entries[2]!.task.artifacts![0]!.parts[0] = { type: 'text', text: 'tampered' };

    const result = await replayCassette(cassette);

    expect(result.integrity.valid).toBe(false);
    expect(result.integrity.failedAtSequence).toBe(2);
    expect(result.matches).toBe(false);
  });

  it('throws when the cassette has no "created" entry to replay from', async () => {
    const cassette = recordCompletedTask('hello', 'world');
    cassette.entries = cassette.entries.filter((entry) => entry.reason !== 'created');

    await expect(replayCassette(cassette)).rejects.toThrow(/no "created" entry/);
  });
});

describe('verifyCassetteIntegrity', () => {
  it('is independently usable without replaying', () => {
    const cassette = recordCompletedTask('hello', 'world');
    expect(verifyCassetteIntegrity(cassette)).toEqual({ valid: true });
  });
});
