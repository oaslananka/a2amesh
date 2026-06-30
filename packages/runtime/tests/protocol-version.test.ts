import { afterEach, describe, expect, it } from 'vitest';
import { A2AServer } from '../src/server/A2AServer.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';
import type { Artifact, Message, Task } from '../src/types/task.js';

class VersionHarnessServer extends A2AServer {
  constructor() {
    super(
      {
        protocolVersion: '1.0',
        name: 'Version Harness',
        description: 'Protocol version negotiation test harness',
        url: 'http://localhost:0',
        version: '1.0.0',
      },
      { allowUnresolvedHostnames: true },
    );
  }

  async handleTask(_task: Task, _message: Message): Promise<Artifact[]> {
    return [];
  }
}

describe('A2A protocol version negotiation', () => {
  const handles: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
  });

  it('returns VersionNotSupportedError for unsupported JSON-RPC versions', async () => {
    const server = new VersionHarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const response = await fetch(`http://localhost:${port}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'A2A-Version': '0.5', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'v', method: 'message/send', params: {} }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: ErrorCodes.VersionNotSupported }),
        id: 'v',
      }),
    );
  });

  it('returns an A2A problem response for unsupported REST versions', async () => {
    const server = new VersionHarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const response = await fetch(`http://localhost:${port}/message:send`, {
      method: 'POST',
      headers: { 'A2A-Version': '0.5', 'Content-Type': 'application/a2a+json' },
      body: JSON.stringify({ message: {} }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toEqual(
      expect.objectContaining({
        status: 400,
        supportedVersions: expect.arrayContaining(['1.0']),
      }),
    );
  });

  it('returns an A2A problem response for unsupported legacy SSE subscription versions', async () => {
    const server = new VersionHarnessServer();
    const listener = server.start(0);
    handles.push(listener);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const port = (listener.address() as { port: number }).port;
    const response = await fetch(`http://localhost:${port}/stream?taskId=task-1`, {
      headers: { 'A2A-Version': '0.5' },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toEqual(
      expect.objectContaining({
        status: 400,
        supportedVersions: expect.arrayContaining(['1.0']),
      }),
    );
  });
});
