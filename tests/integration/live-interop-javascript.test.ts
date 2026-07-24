import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startParticipant, type ParticipantHandle } from '../../scripts/live-interop/process.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const meshServer = path.join(root, 'tests/interop/live/mesh/server.mjs');
const meshClient = path.join(root, 'tests/interop/live/mesh/client.mjs');
const javascriptRoot = path.join(root, 'tests/interop/live/javascript');
const javascriptClient = path.join(javascriptRoot, 'client.mjs');
const javascriptServer = path.join(javascriptRoot, 'server.mjs');
const participants: ParticipantHandle[] = [];

async function startServer(
  name: string,
  script: string,
  args: string[],
  env: Record<string, string>,
) {
  const participant = startParticipant({
    name,
    command: process.execPath,
    args: [script, ...args],
    cwd: root,
    env: { NODE_NO_WARNINGS: '1', ...env },
    secrets: [env['A2A_INTEROP_API_KEY'] ?? ''],
    startupTimeoutMs: 15_000,
  });
  participants.push(participant);
  return participant.waitUntilReady();
}

async function runJson(
  script: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) {
  const { stdout } = await execFileAsync(process.execPath, [script, ...args], {
    cwd,
    env: {
      PATH: process.env['PATH'],
      HOME: process.env['HOME'],
      NODE_NO_WARNINGS: '1',
      ...env,
    },
    timeout: 20_000,
    maxBuffer: 128 * 1024,
  });
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((entry) => entry.trim().startsWith('{'));
  if (!line) throw new Error(`No JSON result from ${script}`);
  return JSON.parse(line) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.allSettled(participants.splice(0).map((participant) => participant.stop()));
});

describe('live official JavaScript SDK interoperability', () => {
  it('runs the official JavaScript client against an authenticated A2A Mesh server', async () => {
    const ready = await startServer('mesh-authenticated', meshServer, ['authenticated'], {
      A2A_INTEROP_API_KEY: 'javascript-live-key',
      A2A_INTEROP_PORT: '0',
    });

    await expect(
      runJson(javascriptClient, ['blocking-auth', ready['url'] as string], javascriptRoot, {
        A2A_INTEROP_API_KEY: 'javascript-live-key',
      }),
    ).resolves.toMatchObject({
      direction: 'official-javascript-client->a2amesh-server',
      sdk: '@a2a-js/sdk',
      sdkVersion: '1.0.0',
      protocolVersion: '1.0',
      authenticationChallenges: 1,
      state: 'TASK_STATE_COMPLETED',
      artifactText: 'mesh:hello from official javascript',
    });
  });

  it('runs the A2A Mesh client against an official JavaScript streaming server', async () => {
    const ready = await startServer('official-javascript-server', javascriptServer, [], {
      A2A_INTEROP_PORT: '0',
    });

    const result = await runJson(meshClient, ['streaming', ready['url'] as string], root, {
      A2A_INTEROP_RPC_DIALECT: 'official-v1',
    });
    expect(result).toMatchObject({
      direction: 'a2amesh-client->a2amesh-server',
      protocolVersion: '1.0',
      terminalState: 'COMPLETED',
      artifactText: 'javascript:hello live stream',
    });
    expect(result['states']).toEqual(expect.arrayContaining(['SUBMITTED', 'WORKING', 'COMPLETED']));
  });
});
