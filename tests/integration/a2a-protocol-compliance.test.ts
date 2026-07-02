import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A2AServer } from '../../packages/runtime/src/server/A2AServer.js';
import { A2AClient } from '../../packages/runtime/src/client/A2AClient.js';
import { ErrorCodes } from '../../packages/runtime/src/types/jsonrpc.js';
import type { Artifact, Message, Task } from '../../packages/runtime/src/types/task.js';
import {
  createUserMessage,
  postJsonRpc,
  startTestServer,
  type StartedServer,
  waitForTaskState,
} from './helpers.js';

class ComplianceAgent extends A2AServer {
  constructor() {
    super(
      {
        protocolVersion: '1.0',
        name: 'Compliance Test Agent',
        description: 'A2A Protocol compliance test agent',
        url: 'http://localhost:0',
        version: '1.0.0',
        capabilities: {
          streaming: true,
          pushNotifications: true,
          stateTransitionHistory: true,
          extendedAgentCard: true,
        },
        extensions: [
          { uri: 'https://a2amesh.test/ext/citations/v1', required: false },
          { uri: 'https://a2amesh.test/ext/required/v1', required: true },
        ],
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      },
      {
        auth: {
          securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
          apiKeys: { 'api-key': 'valid-key' },
        },
      },
    );
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const text = message.parts.find((part) => part.type === 'text');
    return [
      {
        artifactId: 'compliance-artifact',
        parts: [{ type: 'text', text: text?.type === 'text' ? text.text : 'ok' }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

describe('A2A Protocol v1.0 Compliance', () => {
  let handle: StartedServer;
  const authHeaders = { 'x-api-key': 'valid-key' };

  beforeAll(async () => {
    handle = await startTestServer(new ComplianceAgent());
  });

  afterAll(async () => {
    await handle.close();
  });

  describe('Agent Card Discovery', () => {
    it('/.well-known/agent-card.json returns a v1.0 card', async () => {
      const response = await fetch(`${handle.url}/.well-known/agent-card.json`);
      expect(response.status).toBe(200);
      const card = (await response.json()) as Record<string, unknown>;
      expect(card['protocolVersion']).toBe('1.0');
      expect(typeof card['name']).toBe('string');
      expect(typeof card['url']).toBe('string');
      expect(typeof card['version']).toBe('string');
    });

    it('/.well-known/agent.json remains a backwards-compatible alias', async () => {
      const response = await fetch(`${handle.url}/.well-known/agent.json`);
      expect(response.status).toBe(200);
      const card = (await response.json()) as Record<string, unknown>;
      expect(card['protocolVersion']).toBe('1.0');
    });

    it('/health returns service metadata', async () => {
      const response = await fetch(`${handle.url}/health`);
      expect(response.status).toBe(200);
      const health = (await response.json()) as Record<string, unknown>;
      expect(health['status']).toBe('healthy');
      expect(health['protocol']).toBe('A2A/1.0');
      expect(typeof health['version']).toBe('string');
    });
  });

  describe('message/send', () => {
    it('successful requests transition to a completed task', async () => {
      const client = new A2AClient(handle.url, { headers: authHeaders });
      const createdTask = await client.sendMessage({
        message: createUserMessage('hello compliance'),
      });

      const task = await waitForTaskState(client, createdTask.id, ['COMPLETED']);
      expect(task.status.state).toBe('COMPLETED');
      expect(task.artifacts?.length ?? 0).toBeGreaterThan(0);
    });

    it('accepts valid ISO timestamps with timezone offsets', async () => {
      const client = new A2AClient(handle.url, { headers: authHeaders });
      const createdTask = await client.sendMessage({
        message: createUserMessage('hello offset timestamp', {
          timestamp: '2026-04-06T13:00:00+03:00',
        }),
      });

      const task = await waitForTaskState(client, createdTask.id, ['COMPLETED']);
      expect(task.status.state).toBe('COMPLETED');
    });

    it('invalid params return InvalidParams', async () => {
      const body = await postJsonRpc<{ error: { code: number } }>(
        handle.url,
        'message/send',
        {
          message: {},
        },
        authHeaders,
      );

      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(ErrorCodes.InvalidParams);
    });

    it('invalid message timestamps return InvalidParams', async () => {
      const body = await postJsonRpc<{ error: { code: number } }>(
        handle.url,
        'message/send',
        {
          message: createUserMessage('invalid timestamp', { timestamp: 'not-a-date' }),
        },
        authHeaders,
      );

      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(ErrorCodes.InvalidParams);
    });
  });

  describe('Extension Negotiation', () => {
    it('unsupported optional extensions are skipped gracefully', async () => {
      const client = new A2AClient(handle.url, { headers: authHeaders });
      const createdTask = await client.sendMessage({
        message: createUserMessage('extension test'),
        configuration: {
          extensions: [{ uri: 'https://unknown.ext/v1', required: false }],
        },
      });

      const task = await waitForTaskState(client, createdTask.id, ['COMPLETED']);
      expect(task.status.state).toBe('COMPLETED');
    });

    it('unsupported required extensions return ExtensionRequired', async () => {
      const body = await postJsonRpc<{ error: { code: number } }>(
        handle.url,
        'message/send',
        {
          message: createUserMessage('required extension test'),
          configuration: {
            extensions: [{ uri: 'https://unsupported-required.ext/v1', required: true }],
          },
        },
        authHeaders,
      );

      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(ErrorCodes.ExtensionRequired);
    });
  });

  describe('Authentication', () => {
    it('agent/authenticatedExtendedCard returns Unauthorized without auth', async () => {
      const body = await postJsonRpc<{ error: { code: number } }>(
        handle.url,
        'agent/authenticatedExtendedCard',
      );

      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(ErrorCodes.Unauthorized);
    });

    it('agent/getAuthenticatedExtendedCard returns the card with a valid api key', async () => {
      const body = await postJsonRpc<{ result: Record<string, unknown> }>(
        handle.url,
        'agent/getAuthenticatedExtendedCard',
        undefined,
        { 'x-api-key': 'valid-key' },
      );

      expect(body.result).toBeDefined();
      expect(body.result['protocolVersion']).toBe('1.0');
    });

    it('agent/authenticatedExtendedCard returns the card with a valid api key', async () => {
      const body = await postJsonRpc<{ result: Record<string, unknown> }>(
        handle.url,
        'agent/authenticatedExtendedCard',
        undefined,
        { 'x-api-key': 'valid-key' },
      );

      expect(body.result).toBeDefined();
      expect(body.result['protocolVersion']).toBe('1.0');
    });
  });

  describe('tasks/get', () => {
    it('returns an existing task', async () => {
      const client = new A2AClient(handle.url, { headers: authHeaders });
      const task = await client.sendMessage({
        message: createUserMessage('get test'),
      });

      const retrieved = await client.getTask(task.id);
      expect(retrieved.id).toBe(task.id);
    });

    it('returns TaskNotFound for unknown task ids', async () => {
      const body = await postJsonRpc<{ error: { code: number } }>(
        handle.url,
        'tasks/get',
        {
          taskId: 'non-existent-task-id',
        },
        authHeaders,
      );

      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(ErrorCodes.TaskNotFound);
    });
  });
});
