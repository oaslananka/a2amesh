import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager, InMemoryTaskStorage } from '@a2amesh/runtime';
import { CassetteRecorder, serializeCassetteToJsonl } from '@a2amesh/runtime/testing';
import { createReplayCommand } from '../src/commands/replay.js';
import { expectCommandHelp, jsonOptions } from './command-test-helpers.js';

function recordCassetteFile(dir: string): string {
  const taskManager = new TaskManager(new InMemoryTaskStorage());
  const recorder = new CassetteRecorder({ redact: false });
  const unsubscribe = recorder.attach(taskManager);

  const task = taskManager.createTask();
  taskManager.addHistoryMessage(task.id, {
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }],
    messageId: 'message-1',
    timestamp: '2026-07-05T00:00:00.000Z',
  });
  taskManager.addArtifact(task.id, {
    artifactId: 'artifact-1',
    parts: [{ type: 'text', text: 'world' }],
    index: 0,
    lastChunk: true,
  });
  taskManager.updateTaskState(task.id, 'COMPLETED');
  unsubscribe();

  const path = join(dir, 'task.cassette.jsonl');
  writeFileSync(path, serializeCassetteToJsonl(recorder.toCassette()));
  return path;
}

describe('replay command', () => {
  it('defines the replay command', () => {
    const command = createReplayCommand(jsonOptions);

    expect(command.name()).toBe('replay');
    expectCommandHelp(command, ['replay [options] <cassette>', '--step']);
  });

  describe('running against a recorded cassette', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'a2amesh-replay-test-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it('reports a matching replay with exit code 0', async () => {
      const cassettePath = recordCassetteFile(dir);
      const logSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      process.exitCode = undefined;

      const command = createReplayCommand(jsonOptions);
      await command.parseAsync([cassettePath], { from: 'user' });

      const output = logSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(JSON.parse(output)).toMatchObject({ matches: true, integrityValid: true });
      expect(process.exitCode).toBeUndefined();
    });

    it('sets a non-zero exit code when the cassette fails integrity verification', async () => {
      const cassettePath = recordCassetteFile(dir);
      const tamperedJsonl = readFileSync(cassettePath, 'utf8').replace('"world"', '"tampered"');
      writeFileSync(cassettePath, tamperedJsonl);
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      process.exitCode = undefined;

      const command = createReplayCommand(jsonOptions);
      await command.parseAsync([cassettePath], { from: 'user' });

      expect(process.exitCode).toBe(1);
    });
  });
});
