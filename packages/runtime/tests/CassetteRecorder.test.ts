import { describe, expect, it } from 'vitest';
import { InMemoryTaskStorage } from '../src/storage/InMemoryTaskStorage.js';
import { TaskManager } from '../src/server/TaskManager.js';
import {
  CassetteRecorder,
  parseCassetteFromJsonl,
  serializeCassetteToJsonl,
  verifyCassetteIntegrity,
} from '../src/testing/cassette/index.js';
import { redactSecretShapedText, redactTask } from '../src/testing/cassette/redaction.js';
import type { Message, ExtensibleArtifact } from '../src/types/task.js';

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

function recordBasicLifecycle(recorder: CassetteRecorder, taskManager: TaskManager) {
  const unsubscribe = recorder.attach(taskManager);
  const task = taskManager.createTask();
  taskManager.addHistoryMessage(task.id, textMessage('hello'));
  taskManager.addArtifact(task.id, textArtifact('world'));
  taskManager.updateTaskState(task.id, 'COMPLETED');
  unsubscribe();
  return task;
}

describe('CassetteRecorder', () => {
  it('records the taskUpdated sequence with monotonically increasing sequence numbers', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const recorder = new CassetteRecorder({ redact: false });
    recordBasicLifecycle(recorder, taskManager);

    const cassette = recorder.toCassette();
    expect(cassette.entries.map((entry) => entry.reason)).toEqual([
      'created',
      'message',
      'artifact',
      'state',
    ]);
    expect(cassette.entries.map((entry) => entry.sequence)).toEqual([0, 1, 2, 3]);
    expect(cassette.header.formatVersion).toBe('1');
  });

  it('produces a cassette whose integrity hash chain verifies cleanly', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const recorder = new CassetteRecorder({ redact: false });
    recordBasicLifecycle(recorder, taskManager);

    const result = verifyCassetteIntegrity(recorder.toCassette());
    expect(result).toEqual({ valid: true });
  });

  it('fails integrity verification when a recorded entry is tampered with', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const recorder = new CassetteRecorder({ redact: false });
    recordBasicLifecycle(recorder, taskManager);

    const cassette = recorder.toCassette();
    // Flip a single character deep inside the recorded task snapshot.
    cassette.entries[1]!.task.history[0]!.parts[0]! = { type: 'text', text: 'HELLO' };

    const result = verifyCassetteIntegrity(cassette);
    expect(result.valid).toBe(false);
    expect(result.failedAtSequence).toBe(1);
  });

  it('redacts secret-shaped content by default', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const recorder = new CassetteRecorder();
    const unsubscribe = recorder.attach(taskManager);
    const task = taskManager.createTask();
    taskManager.addHistoryMessage(task.id, textMessage('Bearer sk-live-abcdef0123456789ABCDEF'));
    unsubscribe();

    const cassette = recorder.toCassette();
    expect(cassette.header.redacted).toBe(true);
    const recordedText = cassette.entries[1]!.task.history[0]!.parts[0];
    expect(recordedText).toEqual({ type: 'text', text: '[REDACTED]' });
  });

  it('preserves original content when redaction is disabled', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const recorder = new CassetteRecorder({ redact: false });
    const unsubscribe = recorder.attach(taskManager);
    const task = taskManager.createTask();
    taskManager.addHistoryMessage(task.id, textMessage('Bearer sk-live-abcdef0123456789ABCDEF'));
    unsubscribe();

    const cassette = recorder.toCassette();
    expect(cassette.header.redacted).toBe(false);
    expect(cassette.entries[1]!.task.history[0]!.parts[0]).toEqual({
      type: 'text',
      text: 'Bearer sk-live-abcdef0123456789ABCDEF',
    });
  });

  it('only records events for the configured taskId when multiple tasks are active', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const other = taskManager.createTask();
    const target = taskManager.createTask();
    const recorder = new CassetteRecorder({ taskId: target.id, redact: false });
    const unsubscribe = recorder.attach(taskManager);

    taskManager.addHistoryMessage(other.id, textMessage('ignored'));
    taskManager.addHistoryMessage(target.id, textMessage('recorded'));
    unsubscribe();

    const cassette = recorder.toCassette();
    expect(cassette.entries).toHaveLength(1);
    expect(cassette.entries[0]!.task.id).toBe(target.id);
  });

  it('round-trips through JSONL serialization', () => {
    const taskManager = new TaskManager(new InMemoryTaskStorage());
    const recorder = new CassetteRecorder({ redact: false });
    recordBasicLifecycle(recorder, taskManager);

    const cassette = recorder.toCassette();
    const jsonl = serializeCassetteToJsonl(cassette);
    const parsed = parseCassetteFromJsonl(jsonl);

    expect(parsed).toEqual(cassette);
    expect(verifyCassetteIntegrity(parsed)).toEqual({ valid: true });
  });
});

describe('redactSecretShapedText', () => {
  it('redacts bearer tokens, API-key-shaped values, and PEM private key blocks', () => {
    expect(redactSecretShapedText('Bearer abcdefghij0123456789')).toBe('[REDACTED]');
    expect(redactSecretShapedText('api_key=abcdefghij0123456789')).toBe('[REDACTED]');
    // Built via concatenation so this fixture's own file text never contains an
    // unbroken PEM header, avoiding a false positive from scripts/check-no-secrets.mjs.
    const pemHeader = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
    const pemFooter = '-----END RSA ' + 'PRIVATE KEY-----';
    expect(redactSecretShapedText(`${pemHeader}\nMIIBogIBAAJ\n${pemFooter}`)).toBe('[REDACTED]');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecretShapedText('hello world')).toBe('hello world');
  });

  it('redacts nested message, artifact, and metadata content without changing file parts', () => {
    const task = redactTask({
      id: 'task-1',
      status: { state: 'COMPLETED', timestamp: '2026-07-22T00:00:00.000Z' },
      history: [
        {
          role: 'ROLE_USER',
          messageId: 'message-1',
          timestamp: '2026-07-22T00:00:00.000Z',
          parts: [
            { type: 'text', text: 'Bearer abcdefghij0123456789' },
            { type: 'data', data: { nested: ['sk-abcdefghijklmnopqrstuvwxyz'] } },
            { type: 'file', file: { name: 'safe.txt', mimeType: 'text/plain', bytes: 'safe' } },
          ],
        },
      ],
      artifacts: [
        {
          artifactId: 'artifact-1',
          index: 0,
          parts: [{ type: 'text', text: 'api_key=abcdefghij0123456789' }],
          metadata: { token: 'access' + '_token: abcdefghij0123456789' },
        },
      ],
    });

    expect(task.history[0]?.parts).toEqual([
      { type: 'text', text: '[REDACTED]' },
      { type: 'data', data: { nested: ['[REDACTED]'] } },
      { type: 'file', file: { name: 'safe.txt', mimeType: 'text/plain', bytes: 'safe' } },
    ]);
    expect(task.artifacts?.[0]?.parts[0]).toEqual({ type: 'text', text: '[REDACTED]' });
    expect(task.artifacts?.[0]?.metadata).toEqual({ token: '[REDACTED]' });
  });
});
