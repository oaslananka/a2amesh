import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2AServer } from '../../packages/runtime/src/server/A2AServer.js';
import { A2AClient } from '../../packages/runtime/src/client/A2AClient.js';
import type { Artifact, Message, Task } from '../../packages/runtime/src/types/task.js';
import { createUserMessage, startTestServer, waitForTaskState } from './helpers.js';

class IntegrationServer extends A2AServer {
  constructor() {
    super(
      {
        protocolVersion: '1.0',
        name: 'Integration Agent',
        description: 'A mock agent for client/server integration testing',
        url: 'http://localhost:0',
        version: '1.0.0',
        capabilities: {
          streaming: true,
          pushNotifications: true,
          stateTransitionHistory: true,
          extendedAgentCard: true,
        },
        extensions: [{ uri: 'https://example.com/extensions/citations/v1' }],
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      },
      {
        allowUnresolvedHostnames: true,
        auth: {
          securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
          apiKeys: { 'api-key': 'secret' },
        },
      },
    );
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const textPart = message.parts.find((part) => part.type === 'text');
    return [
      {
        artifactId: 'artifact-1',
        parts: [{ type: 'text', text: textPart?.type === 'text' ? textPart.text : 'empty' }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

describe('A2A client/server integration', () => {
  const handles: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(handles.map((handle) => handle.close()));
    handles.length = 0;
  });

  it('supports card resolution, message flow, push notification config and authenticated extended card', async () => {
    const server = new IntegrationServer();
    const handle = await startTestServer(server);
    handles.push(handle);

    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://example.com/')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return realFetch(input, init);
    });

    const client = new A2AClient(handle.url, {
      headers: { 'x-api-key': 'secret' },
    });

    const card = await client.resolveCard();
    expect(card.name).toBe('Integration Agent');

    const extendedCard = await client.getExtendedAgentCard();
    expect(extendedCard.name).toBe('Integration Agent');

    const createdTask = await client.sendMessage({
      message: createUserMessage('hello'),
      contextId: 'ctx-1',
      configuration: {
        pushNotificationConfig: { url: 'https://example.com/hook' },
        extensions: [{ uri: 'https://example.com/extensions/citations/v1', required: true }],
      },
    });

    expect(createdTask.contextId).toBe('ctx-1');

    expect(await client.getPushNotification(createdTask.id)).toEqual({
      url: 'https://example.com/hook',
    });

    const task = await waitForTaskState(client, createdTask.id, ['COMPLETED']);
    expect(task.artifacts?.[0]?.parts[0]).toEqual({ type: 'text', text: 'hello' });

    const response = await fetch(`${handle.url}/a2a/jsonrpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'secret',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'auth-1',
        method: 'agent/authenticatedExtendedCard',
      }),
    });
    const payload = (await response.json()) as { result: { name: string } };
    expect(payload.result.name).toBe('Integration Agent');
  });

  it('supports streaming task updates and health checks', async () => {
    const server = new IntegrationServer();
    const handle = await startTestServer(server);
    handles.push(handle);

    const client = new A2AClient(handle.url, {
      headers: { 'x-api-key': 'secret' },
    });

    const health = await client.health();
    expect(health.status).toBe('healthy');

    const updates: Task[] = [];
    const stream = await client.sendMessageStream({
      message: createUserMessage('watch me stream'),
      contextId: 'ctx-stream',
    });

    for await (const update of stream) {
      updates.push(update as Task);
    }

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1]?.status.state).toBe('COMPLETED');
    expect(updates[updates.length - 1]?.artifacts?.[0]?.parts[0]).toEqual({
      type: 'text',
      text: 'watch me stream',
    });
  });
});
