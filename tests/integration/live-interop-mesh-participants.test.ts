import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startParticipant, type ParticipantHandle } from '../../scripts/live-interop/process.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const serverScript = path.join(root, 'tests/interop/live/mesh/server.mjs');
const clientScript = path.join(root, 'tests/interop/live/mesh/client.mjs');
const participants: ParticipantHandle[] = [];

async function startMeshServer(mode: 'complete' | 'cancellable' | 'authenticated') {
  const participant = startParticipant({
    name: `mesh-${mode}`,
    command: process.execPath,
    args: [serverScript, mode],
    cwd: root,
    env: {
      A2A_INTEROP_API_KEY: 'mesh-live-key',
      A2A_INTEROP_PORT: '0',
      NODE_NO_WARNINGS: '1',
    },
    secrets: ['mesh-live-key'],
    startupTimeoutMs: 10_000,
  });
  participants.push(participant);
  const ready = await participant.waitUntilReady();
  expect(ready).toMatchObject({ type: 'ready', participant: 'a2amesh-server', mode });
  return ready['url'] as string;
}

async function runClient(command: string, url: string, extraEnv: Record<string, string> = {}) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [clientScript, command, url], {
    cwd: root,
    env: {
      PATH: process.env['PATH'],
      HOME: process.env['HOME'],
      NODE_NO_WARNINGS: '1',
      ...extraEnv,
    },
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  expect(stderr).toBe('');
  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.allSettled(participants.splice(0).map((participant) => participant.stop()));
});

describe('live A2A Mesh participants', () => {
  it('completes a blocking task with a deterministic artifact', async () => {
    const url = await startMeshServer('complete');
    await expect(runClient('blocking', url)).resolves.toMatchObject({
      direction: 'a2amesh-client->a2amesh-server',
      protocolVersion: '1.0',
      state: 'COMPLETED',
      artifactText: 'mesh:hello live interop',
    });
  });

  it('streams task states through completion', async () => {
    const url = await startMeshServer('complete');
    const result = await runClient('streaming', url);
    expect(result).toMatchObject({
      direction: 'a2amesh-client->a2amesh-server',
      protocolVersion: '1.0',
      terminalState: 'COMPLETED',
      artifactText: 'mesh:hello live stream',
    });
    expect(result['states']).toEqual(expect.arrayContaining(['WORKING', 'COMPLETED']));
  });

  it('challenges missing credentials and accepts the configured API key', async () => {
    const url = await startMeshServer('authenticated');
    await expect(runClient('challenge', url)).resolves.toMatchObject({
      status: 401,
      category: 'authentication-required',
    });
    await expect(
      runClient('blocking-auth', url, { A2A_INTEROP_API_KEY: 'mesh-live-key' }),
    ).resolves.toMatchObject({
      state: 'COMPLETED',
      artifactText: 'mesh:hello authenticated interop',
    });
  });

  it('creates and cancels a long-running task', async () => {
    const url = await startMeshServer('cancellable');
    await expect(runClient('cancel', url)).resolves.toMatchObject({
      direction: 'a2amesh-client->a2amesh-server',
      protocolVersion: '1.0',
      state: 'CANCELED',
    });
  });

  it('returns a bounded incompatible-version diagnostic', async () => {
    const url = await startMeshServer('complete');
    const result = await runClient('negative-version', url);
    expect(result).toMatchObject({
      requestedVersion: '9.9',
      category: 'unsupported-version',
    });
    expect(JSON.stringify(result).length).toBeLessThan(2_048);
  });
});
