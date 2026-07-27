import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  JsonRpcError,
  TaskManager,
  type AgentCard,
  type Message,
} from '@a2amesh/runtime';
import WebSocket from 'ws';
import { WsClient } from '../src/WsClient.js';
import { WsServer } from '../src/WsServer.js';
import {
  runTransportContract,
  type TransportCapabilityMap,
} from '../../../tests/transport-contract/transportContract.js';

const WS_CAPABILITIES: TransportCapabilityMap = {
  sendMessage: { supported: true },
  streamMessage: {
    supported: false,
    reason: 'WebSocket transport currently exposes request/response JSON-RPC for WebSocket.',
  },
  getTask: { supported: true },
  cancelTask: { supported: true },
  resolveCard: { supported: true },
  health: { supported: true },
  authErrors: {
    supported: false,
    reason: 'WebSocket Contract Agent has no authentication handshake in WsServerOptions.',
  },
  malformedRequests: { supported: true },
  versionNegotiation: { supported: true },
};

class WsContractRuntime {
  private readonly taskManager = new TaskManager();

  constructor(private readonly agentCard: AgentCard) {}

  async handleRequest(request: { method: string; params?: unknown }): Promise<unknown> {
    const params = (request.params ?? {}) as Record<string, unknown>;
    switch (request.method) {
      case 'agent/card':
        return this.agentCard;
      case 'health':
        return { status: 'healthy', version: this.agentCard.version, protocol: 'A2A/1.0' };
      case 'message/send':
        return this.sendMessage(params['message'] as Message | undefined, params['contextId']);
      case 'tasks/get':
        return this.getTask(params['taskId']);
      case 'tasks/cancel':
        return this.cancelTask(params['taskId']);
      default:
        throw new JsonRpcError(ErrorCodes.MethodNotFound, `Method ${request.method} not found`);
    }
  }

  private sendMessage(message: Message | undefined, contextId: unknown) {
    if (!message) {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing message');
    }
    const task = this.taskManager.createTask(
      undefined,
      typeof contextId === 'string' ? contextId : undefined,
    );
    this.taskManager.addHistoryMessage(task.id, message);
    this.taskManager.updateTaskState(task.id, 'WORKING');
    void this.completeTask(task.id, readMessageText(message));
    return this.taskManager.getTask(task.id) ?? task;
  }

  private getTask(taskId: unknown) {
    if (typeof taskId !== 'string') {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
    }
    const task = this.taskManager.getTask(taskId);
    if (!task) {
      throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
    }
    return task;
  }

  private cancelTask(taskId: unknown) {
    if (typeof taskId !== 'string') {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
    }
    const task = this.taskManager.cancelTask(taskId);
    if (!task) {
      throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
    }
    return task;
  }

  private async completeTask(taskId: string, text: string): Promise<void> {
    await delay(text === 'contract-cancel' ? 250 : 10);
    const task = this.taskManager.getTask(taskId);
    if (!task || task.status.state === 'CANCELED') {
      return;
    }
    this.taskManager.addArtifact(taskId, {
      artifactId: `artifact-${taskId}`,
      parts: [{ type: 'text', text: `echo:${text}` }],
      index: 0,
      lastChunk: true,
      metadata: { taskId },
    });
    this.taskManager.updateTaskState(taskId, 'COMPLETED');
  }
}

runTransportContract({
  name: 'WebSocket',
  capabilities: WS_CAPABILITIES,
  async createSession() {
    const agentCard: AgentCard = {
      protocolVersion: '1.0',
      name: 'WebSocket Contract Agent',
      description: 'Contract test agent for WebSocket transport',
      url: 'ws://127.0.0.1:0/a2amesh-ws',
      version: '1.0.0',
      capabilities: { stateTransitionHistory: true },
      supportedInterfaces: [
        {
          protocolBinding: 'WebSocket',
          protocolVersion: '1.0',
          url: 'ws://127.0.0.1:0/a2amesh-ws',
        },
      ],
    };
    const runtime = new WsContractRuntime(agentCard);
    const server = new WsServer({ handleRequest: (request) => runtime.handleRequest(request) });
    const port = await server.start();
    const url = `ws://127.0.0.1:${port}/a2amesh-ws`;
    agentCard.url = url;
    agentCard.supportedInterfaces = [
      {
        protocolBinding: 'WebSocket',
        protocolVersion: '1.0',
        url,
      },
    ];
    const client = new WsClient(url, { requestTimeoutMs: 2000 });

    return {
      sendMessage(text, options) {
        const message = createUserMessage(text, options?.contextId);
        if (options?.returnImmediately) {
          return client.request('message/send', {
            message,
            ...(options.contextId ? { contextId: options.contextId } : {}),
            configuration: { returnImmediately: true },
          });
        }
        return client.sendMessage(message);
      },
      getTask(taskId) {
        return client.getTask(taskId);
      },
      cancelTask(taskId) {
        return client.request('tasks/cancel', { taskId });
      },
      resolveCard() {
        return client.request('agent/card');
      },
      health() {
        return client.request('health');
      },
      sendMalformedRequest() {
        return sendMalformedWsRequest(url);
      },
      negotiateUnsupportedVersion() {
        return negotiateUnsupportedWsVersion(url);
      },
      async close() {
        await client.close();
        await server.close();
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

function createUserMessage(text: string, contextId?: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...(contextId ? { contextId } : {}),
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

async function sendMalformedWsRequest(
  url: string,
): Promise<{ code?: number | string; message: string }> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const response = await new Promise<JsonRpcFailureEnvelope>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for malformed response')),
      2000,
    );
    socket.once('message', (payload) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(payload)) as JsonRpcFailureEnvelope);
    });
    socket.send(JSON.stringify({ jsonrpc: '1.0', id: 'bad', method: 'message/send' }));
  });
  socket.close();

  return {
    ...(response.error?.code !== undefined ? { code: response.error.code } : {}),
    message: response.error?.message ?? 'missing error',
  };
}

async function negotiateUnsupportedWsVersion(
  url: string,
): Promise<{ code?: number | string; message: string }> {
  const endpoint = new URL(url);
  endpoint.searchParams.set('A2A-Version', '9.9');
  const socket = new WebSocket(endpoint);

  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('close', (code, reason) => {
      resolve({ code, message: reason.toString() });
    });
  });
}
