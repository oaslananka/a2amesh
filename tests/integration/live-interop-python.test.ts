import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startParticipant, type ParticipantHandle } from '../../scripts/live-interop/process.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const python = process.env['A2A_INTEROP_PYTHON'];
const meshServer = path.join(root, 'tests/interop/live/mesh/server.mjs');
const meshClient = path.join(root, 'tests/interop/live/mesh/client.mjs');
const pythonRoot = path.join(root, 'tests/interop/live/python');
const pythonClient = path.join(pythonRoot, 'client.py');
const pythonServer = path.join(pythonRoot, 'server.py');
const participants: ParticipantHandle[] = [];

async function startServer(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string>,
) {
  const participant = startParticipant({
    name,
    command,
    args,
    cwd: root,
    env,
    startupTimeoutMs: 20_000,
  });
  participants.push(participant);
  return participant.waitUntilReady();
}

async function runJson(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    env: {
      PATH: process.env['PATH'],
      HOME: process.env['HOME'],
      NODE_NO_WARNINGS: '1',
      PYTHONUNBUFFERED: '1',
      ...env,
    },
    timeout: 30_000,
    maxBuffer: 128 * 1024,
  });
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.trim().startsWith('{'));
  if (!line) throw new Error(`No JSON result from ${command} ${args.join(' ')}`);
  return JSON.parse(line) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.allSettled(participants.splice(0).map((participant) => participant.stop()));
});

const liveDescribe = python ? describe : describe.skip;

liveDescribe('live official Python SDK interoperability', () => {
  it('runs the official Python client through create, get, and cancel against A2A Mesh', async () => {
    const ready = await startServer(
      'mesh-cancellable',
      process.execPath,
      [meshServer, 'cancellable'],
      {
        A2A_INTEROP_PORT: '0',
        NODE_NO_WARNINGS: '1',
      },
    );

    await expect(
      runJson(python!, [pythonClient, 'cancel', ready['url'] as string], pythonRoot),
    ).resolves.toMatchObject({
      direction: 'official-python-client->a2amesh-server',
      sdk: 'a2a-sdk',
      sdkVersion: '1.1.2',
      protocolVersion: '1.0',
      state: 'TASK_STATE_CANCELED',
    });
  });

  it('runs blocking and streaming A2A Mesh calls against an official Python server', async () => {
    const ready = await startServer('official-python-server', python!, [pythonServer], {
      A2A_INTEROP_PORT: '0',
      PYTHONUNBUFFERED: '1',
    });
    const url = ready['url'] as string;

    await expect(
      runJson(process.execPath, [meshClient, 'blocking', url], root, {
        A2A_INTEROP_RPC_DIALECT: 'official-v1',
      }),
    ).resolves.toMatchObject({
      direction: 'a2amesh-client->a2amesh-server',
      protocolVersion: '1.0',
      state: 'COMPLETED',
      artifactText: 'python:hello live interop',
    });

    const stream = await runJson(process.execPath, [meshClient, 'streaming', url], root, {
      A2A_INTEROP_RPC_DIALECT: 'official-v1',
    });
    expect(stream).toMatchObject({
      terminalState: 'COMPLETED',
      artifactText: 'python:hello live stream',
    });
    expect(stream['states']).toEqual(expect.arrayContaining(['WORKING', 'COMPLETED']));
  });
});
