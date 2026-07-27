import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Artifact, Message, Task } from '../../packages/runtime/src/index.js';
import { A2AClient, A2AServer } from '../../packages/runtime/src/index.js';
import { runTransportContract, type TransportCapabilityMap } from './transportContract.js';

const HTTP_CAPABILITIES: TransportCapabilityMap = {
  sendMessage: { supported: true },
  streamMessage: { supported: true },
  getTask: { supported: true },
  cancelTask: { supported: true },
  resolveCard: { supported: true },
  health: { supported: true },
  authErrors: { supported: true },
  malformedRequests: { supported: true },
  versionNegotiation: { supported: true },
};

class HttpSseContractServer extends A2AServer {
  constructor() {
    super(
      {
        protocolVersion: '1.0',
        name: 'HTTP/SSE Contract Agent',
        description: 'Contract test agent for HTTP and SSE transports',
        url: 'http://localhost:0',
        version: '1.0.0',
        capabilities: {
          streaming: true,
          stateTransitionHistory: true,
        },
        supportedInterfaces: [
          {
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
            url: 'http://localhost:0',
          },
        ],
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

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    await delay(readMessageText(message) === 'contract-cancel' ? 250 : 10);
    return [
      {
        artifactId: `artifact-${task.id}`,
        parts: [{ type: 'text', text: `echo:${readMessageText(message)}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

runTransportContract({
  name: 'HTTP/SSE',
  capabilities: HTTP_CAPABILITIES,
  async createSession() {
    const agent = new HttpSseContractServer();
    const server = agent.start(0) as Server;
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;
    agent.getAgentCard().url = url;
    agent.getAgentCard().supportedInterfaces = [
      {
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '1.0',
        url,
      },
    ];
    const client = new A2AClient(url, {
      headers: { 'x-api-key': 'secret' },
      retry: { backoffMs: 1, maxAttempts: 1 },
    });

    return {
      sendMessage(text, options) {
        return client.sendMessage({
          message: createUserMessage(text),
          ...(options?.contextId ? { contextId: options.contextId } : {}),
          ...(options?.returnImmediately ? { configuration: { returnImmediately: true } } : {}),
        });
      },
      async streamMessage(text, options) {
        const stream = await client.sendMessageStream({
          message: createUserMessage(text),
          ...(options?.contextId ? { contextId: options.contextId } : {}),
        });
        return stream as AsyncIterable<Task>;
      },
      getTask(taskId) {
        return client.getTask(taskId);
      },
      cancelTask(taskId) {
        return client.cancelTask(taskId);
      },
      resolveCard() {
        return client.resolveCard();
      },
      health() {
        return client.health();
      },
      async sendWithoutAuth() {
        const response = await postJsonRpc(url, 'message/send', {
          message: createUserMessage('unauthorized'),
        });
        return extractFailure(response);
      },
      async sendMalformedRequest() {
        const response = await fetch(`${url}/a2a/jsonrpc`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'secret',
          },
          body: JSON.stringify({ jsonrpc: '1.0', id: 'bad', method: 'message/send' }),
        });
        return extractFailure((await response.json()) as JsonRpcFailureEnvelope);
      },
      async negotiateUnsupportedVersion() {
        const response = await fetch(`${url}/a2a/jsonrpc`, {
          method: 'POST',
          headers: {
            'A2A-Version': '9.9',
            'Content-Type': 'application/json',
            'x-api-key': 'secret',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'unsupported-version',
            method: 'tasks/list',
            params: {},
          }),
        });
        return extractFailure((await response.json()) as JsonRpcFailureEnvelope);
      },
      close() {
        return agent.stop();
      },
    };
  },
});

interface JsonRpcFailureEnvelope {
  error?: {
    code?: number | string;
    message?: string;
  };
}

function createUserMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

function readMessageText(message: Message): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJsonRpc(
  url: string,
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcFailureEnvelope> {
  const response = await fetch(`${url}/a2a/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    }),
  });
  return (await response.json()) as JsonRpcFailureEnvelope;
}

function extractFailure(response: JsonRpcFailureEnvelope): {
  code?: number | string;
  message: string;
} {
  return {
    ...(response.error?.code !== undefined ? { code: response.error.code } : {}),
    message: response.error?.message ?? 'missing error',
  };
}
