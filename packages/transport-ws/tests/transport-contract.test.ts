import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  JsonRpcError,
  TaskManager,
  type AgentCard,
  type Message,
  type PushNotificationConfig,
  type Task,
  type TaskListParams,
} from '@a2amesh/runtime';
import WebSocket from 'ws';
import { WsClient } from '../src/WsClient.js';
import { WsServer } from '../src/WsServer.js';
import {
  runTransportContract,
  type TransportCapabilityMap,
} from '../../../tests/transport-contract/transportContract.js';

const CONTRACT_AUTHORIZATION = 'Bearer contract-token';
const TERMINAL_TASK_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED']);

const WS_CAPABILITIES: TransportCapabilityMap = {
  sendMessage: { supported: true },
  streamMessage: { supported: true },
  getTask: { supported: true },
  listTasks: { supported: true },
  cancelTask: { supported: true },
  resubscribeTask: { supported: true },
  createPushNotificationConfig: { supported: true },
  getPushNotificationConfig: { supported: true },
  listPushNotificationConfigs: { supported: true },
  deletePushNotificationConfig: { supported: true },
  resolveCard: { supported: true },
  getAuthenticatedExtendedCard: { supported: true },
  health: { supported: true },
  authErrors: { supported: true },
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
      case 'agent/getAuthenticatedExtendedCard':
        return this.agentCard;
      case 'health':
        return { status: 'healthy', version: this.agentCard.version, protocol: 'A2A/1.0' };
      case 'message/send':
        return this.sendMessage(params['message'] as Message | undefined, params['contextId']);
      case 'tasks/get':
        return this.getTask(params['taskId']);
      case 'tasks/list':
        return this.listTasks(params);
      case 'tasks/cancel':
        return this.cancelTask(params['taskId']);
      case 'tasks/pushNotificationConfig/create':
        return this.createPushNotificationConfig(params);
      case 'tasks/pushNotificationConfig/get':
        return this.getPushNotificationConfig(params);
      case 'tasks/pushNotificationConfig/list':
        return this.listPushNotificationConfigs(params);
      case 'tasks/pushNotificationConfig/delete':
        return this.deletePushNotificationConfig(params);
      default:
        throw new JsonRpcError(ErrorCodes.MethodNotFound, `Method ${request.method} not found`);
    }
  }

  async handleStream(request: { method: string; params?: unknown }): Promise<AsyncIterable<Task>> {
    const params = (request.params ?? {}) as Record<string, unknown>;
    if (request.method === 'message/stream') {
      const task = this.sendMessage(params['message'] as Message | undefined, params['contextId']);
      return this.streamTask(task.id);
    }
    if (request.method === 'tasks/resubscribe') {
      const task = this.getTask(params['taskId']);
      return this.streamTask(task.id);
    }
    throw new JsonRpcError(
      ErrorCodes.UnsupportedOperation,
      `Method ${request.method} is not streamable`,
    );
  }

  private sendMessage(message: Message | undefined, contextId: unknown): Task {
    if (!message) {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing message');
    }
    const task = this.taskManager.createTask(
      undefined,
      typeof contextId === 'string' ? contextId : message.contextId,
    );
    this.taskManager.addHistoryMessage(task.id, message);
    this.taskManager.updateTaskState(task.id, 'WORKING');
    void this.completeTask(task.id, readMessageText(message));
    return this.taskManager.getTask(task.id) ?? task;
  }

  private getTask(taskId: unknown): Task {
    if (typeof taskId !== 'string') {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
    }
    const task = this.taskManager.getTask(taskId);
    if (!task) {
      throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
    }
    return task;
  }

  private listTasks(params: Record<string, unknown>) {
    const listParams = params as TaskListParams;
    const tasks = listParams.contextId
      ? this.taskManager.getTasksByContext(listParams.contextId)
      : this.taskManager.getAllTasks();
    const offset = listParams.offset ?? 0;
    const limit = listParams.limit ?? 50;
    return { tasks: tasks.slice(offset, offset + limit), total: tasks.length };
  }

  private cancelTask(taskId: unknown): Task {
    const existing = this.getTask(taskId);
    return this.taskManager.cancelTask(existing.id) ?? existing;
  }

  private createPushNotificationConfig(params: Record<string, unknown>) {
    const task = this.getTask(params['taskId']);
    const config = params['pushNotificationConfig'];
    if (!config || typeof config !== 'object') {
      throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing push notification config');
    }
    const configId = readConfigId(params, config as PushNotificationConfig);
    return this.taskManager.setPushNotificationConfig(
      task.id,
      configId,
      config as PushNotificationConfig,
    );
  }

  private getPushNotificationConfig(params: Record<string, unknown>) {
    const task = this.getTask(params['taskId']);
    return this.taskManager.getPushNotificationConfig(task.id, readConfigId(params)) ?? null;
  }

  private listPushNotificationConfigs(params: Record<string, unknown>) {
    const task = this.getTask(params['taskId']);
    return { configs: this.taskManager.listPushNotifications(task.id) };
  }

  private deletePushNotificationConfig(params: Record<string, unknown>) {
    const task = this.getTask(params['taskId']);
    return {
      deleted: this.taskManager.removePushNotificationConfig(task.id, readConfigId(params)),
    };
  }

  private async *streamTask(taskId: string): AsyncGenerator<Task> {
    const queue: Task[] = [];
    let wake: (() => void) | undefined;
    let completed: boolean;

    const notify = () => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };
    const onTaskUpdated = ({ task }: { task: Task }) => {
      if (task.id !== taskId) {
        return;
      }
      queue.push(task);
      if (TERMINAL_TASK_STATES.has(task.status.state)) {
        completed = true;
      }
      notify();
    };

    this.taskManager.on('taskUpdated', onTaskUpdated);
    try {
      const current = this.getTask(taskId);
      queue.push(current);
      completed = TERMINAL_TASK_STATES.has(current.status.state);

      while (!completed || queue.length > 0) {
        const update = queue.shift();
        if (update) {
          yield update;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this.taskManager.off('taskUpdated', onTaskUpdated);
    }
  }

  private async completeTask(taskId: string, text: string): Promise<void> {
    await delay(
      ['contract-cancel', 'contract-resubscribe', 'contract-push-config'].includes(text) ? 250 : 10,
    );
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
      capabilities: {
        streaming: true,
        stateTransitionHistory: true,
        extendedAgentCard: true,
      },
      supportedInterfaces: [
        {
          protocolBinding: 'WebSocket',
          protocolVersion: '1.0',
          url: 'ws://127.0.0.1:0/a2amesh-ws',
        },
      ],
    };
    const runtime = new WsContractRuntime(agentCard);
    const server = new WsServer({
      authenticate: (request) => request.headers.authorization === CONTRACT_AUTHORIZATION,
      handleRequest: (request) => runtime.handleRequest(request),
      handleStream: (request) => runtime.handleStream(request),
    });
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
    const client = new WsClient(url, {
      requestTimeoutMs: 2000,
      headers: { authorization: CONTRACT_AUTHORIZATION },
    });

    return {
      sendMessage(text, options) {
        const message = createUserMessage(text, options?.contextId);
        return client.sendMessage(message, {
          ...(options?.contextId ? { contextId: options.contextId } : {}),
          ...(options?.returnImmediately ? { configuration: { returnImmediately: true } } : {}),
        });
      },
      streamMessage(text, options) {
        const message = createUserMessage(text, options?.contextId);
        return Promise.resolve(
          client.streamMessage(message, {
            ...(options?.contextId ? { contextId: options.contextId } : {}),
          }),
        );
      },
      getTask(taskId) {
        return client.getTask(taskId);
      },
      listTasks(params) {
        return client.listTasks(params);
      },
      cancelTask(taskId) {
        return client.cancelTask(taskId);
      },
      resubscribeTask(taskId) {
        return Promise.resolve(client.subscribeTask(taskId));
      },
      createPushNotificationConfig(taskId, config, configId) {
        return client.createPushNotificationConfig(taskId, config, configId);
      },
      getPushNotificationConfig(taskId, configId) {
        return client.getPushNotificationConfig(taskId, configId);
      },
      listPushNotificationConfigs(taskId) {
        return client.listPushNotificationConfigs(taskId);
      },
      deletePushNotificationConfig(taskId, configId) {
        return client.deletePushNotificationConfig(taskId, configId);
      },
      resolveCard() {
        return client.getAgentCard();
      },
      getAuthenticatedExtendedCard() {
        return client.getAuthenticatedExtendedCard();
      },
      health() {
        return client.health();
      },
      sendWithoutAuth() {
        return sendWithoutWsAuth(url);
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

function readConfigId(params: Record<string, unknown>, config?: PushNotificationConfig): string {
  const value = params['configId'] ?? config?.id;
  return typeof value === 'string' && value.trim() ? value.trim() : 'default';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithoutWsAuth(
  url: string,
): Promise<{ code?: number | string; message: string }> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('close', (code, reason) => {
      resolve({ code, message: reason.toString() || 'Unauthorized' });
    });
  });
}

async function sendMalformedWsRequest(
  url: string,
): Promise<{ code?: number | string; message: string }> {
  const socket = new WebSocket(url, { headers: { authorization: CONTRACT_AUTHORIZATION } });
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
  const socket = new WebSocket(endpoint, {
    headers: { authorization: CONTRACT_AUTHORIZATION },
  });

  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('close', (code, reason) => {
      resolve({ code, message: reason.toString() });
    });
  });
}
