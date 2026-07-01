import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentCard, Task } from '@a2amesh/runtime';
import { createConformanceCommand } from '../src/commands/conformance.js';
import { runCli } from '../src/index.js';
import { expectCommandHelp, jsonOptions } from './command-test-helpers.js';

const agentCard = {
  protocolVersion: '1.0',
  name: 'CLI Fixture Agent',
  description: 'Endpoint for CLI conformance tests',
  url: 'http://agent.test',
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
    extendedAgentCard: true,
  },
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'echo', name: 'Echo', description: 'Echoes fixture messages' }],
} satisfies AgentCard;

const completedTask = {
  id: 'task-1',
  contextId: 'ctx-a2a-1-0',
  status: {
    state: 'COMPLETED',
    timestamp: '2026-05-24T12:00:01Z',
  },
  history: [],
  artifacts: [
    {
      artifactId: 'artifact-1',
      parts: [{ type: 'text', text: 'fixture result' }],
      index: 0,
      lastChunk: true,
    },
  ],
} satisfies Task;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockConformanceFetch(
  options: { failMessage?: string; card?: AgentCard; task?: Task } = {},
): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/.well-known/agent-card.json')) {
      return jsonResponse(options.card ?? agentCard);
    }
    if (url.endsWith('/a2a/jsonrpc')) {
      if (options.failMessage) {
        return jsonResponse({
          jsonrpc: '2.0',
          id: 'fixture-rpc',
          error: { code: -32603, message: options.failMessage },
        });
      }
      return jsonResponse({
        jsonrpc: '2.0',
        id: 'fixture-rpc',
        result: options.task ?? completedTask,
      });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('conformance command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('defines the conformance command with report and shared network options', () => {
    const command = createConformanceCommand(jsonOptions);

    expect(command.name()).toBe('conformance');
    expectCommandHelp(command, [
      'conformance [options] <url>',
      '--protocol-version <version>',
      '--experimental-profiles',
      '--json',
      '--junit <path>',
      '--gate',
      '--timeout-ms <ms>',
      '--bearer-token <token>',
    ]);
  });

  it('emits a JSON report and exits nonzero when required conformance cases fail', async () => {
    mockConformanceFetch({ failMessage: 'Fixture rejected' });
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });

    await runCli([
      'node',
      'a2amesh',
      'conformance',
      'http://agent.test',
      '--json',
      '--timeout-ms',
      '250',
    ]);

    const payload = JSON.parse(stdout) as {
      schemaVersion: string;
      summary: { failed: number };
      cases: Array<{ id: string; required: boolean; status: string; message?: string }>;
    };
    expect(process.exitCode).toBe(1);
    expect(payload.schemaVersion).toBe('1.0');
    expect(payload.summary.failed).toBe(1);
    expect(payload.cases).toContainEqual(
      expect.objectContaining({
        id: 'message-send',
        required: true,
        status: 'fail',
        message: 'Fixture rejected (-32603)',
      }),
    );
  });


  it('adds local gate metadata when run as a release gate', async () => {
    mockConformanceFetch();
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });

    await runCli(['node', 'a2amesh', 'conformance', 'http://agent.test', '--gate', '--json']);

    const payload = JSON.parse(stdout) as {
      summary: { failed: number };
      profile?: { id: string };
      localGate?: { id: string; command: string; ciEquivalent: string; required: boolean };
    };
    expect(process.exitCode).toBeUndefined();
    expect(payload.summary.failed).toBe(0);
    expect(payload.profile?.id).toBe('official-a2a-v1.0');
    expect(payload.localGate).toEqual(
      expect.objectContaining({
        id: 'conformance',
        command: 'a2amesh conformance http://agent.test --gate --json',
        ciEquivalent: 'CI / conformance',
        required: true,
      }),
    );
  });

  it('writes JUnit XML that CI systems can consume', async () => {
    mockConformanceFetch();
    const tempDir = await mkdtemp(join(tmpdir(), 'a2a-conformance-'));
    const junitPath = join(tempDir, 'conformance.xml');
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });

    await runCli([
      'node',
      'a2amesh',
      'conformance',
      'http://agent.test',
      '--json',
      '--junit',
      junitPath,
    ]);

    const payload = JSON.parse(stdout) as { summary: { failed: number; skipped: number } };
    const junit = await readFile(junitPath, 'utf8');
    expect(process.exitCode).toBeUndefined();
    expect(payload.summary.failed).toBe(0);
    expect(payload.summary.skipped).toBe(2);
    expect(junit).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(junit).toContain('<testsuite');
    expect(junit).toContain('tests="7"');
    expect(junit).toContain('failures="0"');
    expect(junit).toContain('skipped="2"');
    expect(junit).toContain('<testcase name="message-send"');
    expect(junit).toContain('<skipped message="Capability is not advertised" />');
  });

  it('rejects experimental protocol profiles unless the flag opts in', async () => {
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });

    await runCli([
      'node',
      'a2amesh',
      'conformance',
      'http://agent.test',
      '--protocol-version',
      '1.2',
      '--json',
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('--experimental-profiles');
  });

  it('runs experimental protocol profiles when explicitly enabled', async () => {
    mockConformanceFetch({
      card: { ...agentCard, protocolVersion: '1.2', version: '1.2.0' },
      task: {
        ...completedTask,
        contextId: 'ctx-a2a-1-2',
        status: {
          ...completedTask.status,
          timestamp: '2026-05-24T13:00:01+03:00',
        },
      },
    });
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });

    await runCli([
      'node',
      'a2amesh',
      'conformance',
      'http://agent.test',
      '--protocol-version',
      '1.2',
      '--experimental-profiles',
      '--json',
    ]);

    const payload = JSON.parse(stdout) as {
      protocolVersion: string;
      summary: { failed: number };
    };
    expect(process.exitCode).toBeUndefined();
    expect(payload.protocolVersion).toBe('1.2');
    expect(payload.summary.failed).toBe(0);
  });
});
