import type { Artifact, Message, Task } from '@a2amesh/runtime';
import { A2AServer, type AgentCard } from '@a2amesh/runtime';
import { GrpcClient } from '../src/GrpcClient.js';
import { GrpcServer } from '../src/GrpcServer.js';
import {
  runTransportContract,
  type TransportCapabilityMap,
} from '../../../tests/transport-contract/transportContract.js';

const CONTRACT_AUTHORIZATION = 'Bearer contract-token';

const GRPC_CAPABILITIES: TransportCapabilityMap = {
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
  malformedRequests: {
    supported: false,
    reason:
      'gRPC Contract Agent uses typed protobuf requests, so malformed JSON-RPC envelopes are not accepted by gRPC.',
  },
  versionNegotiation: { supported: true },
};

class GrpcContractA2AServer extends A2AServer {
  constructor(agentCard: AgentCard) {
    super(agentCard, { allowUnresolvedHostnames: true });
  }

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    const text = readMessageText(message);
    await delay(
      ['contract-cancel', 'contract-resubscribe', 'contract-push-config'].includes(text) ? 250 : 10,
    );
    return [
      {
        artifactId: `artifact-${task.id}`,
        parts: [{ type: 'text', text: `echo:${text}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

runTransportContract({
  name: 'gRPC',
  capabilities: GRPC_CAPABILITIES,
  async createSession() {
    const agentCard: AgentCard = {
      protocolVersion: '1.0',
      name: 'gRPC Contract Agent',
      description: 'Contract test agent for gRPC transport',
      url: 'grpc://127.0.0.1:0',
      version: '1.0.0',
      capabilities: {
        streaming: true,
        stateTransitionHistory: true,
        extendedAgentCard: true,
      },
      supportedInterfaces: [
        {
          protocolBinding: 'gRPC',
          protocolVersion: '1.0',
          url: 'grpc://127.0.0.1:0',
        },
      ],
    };
    const adapter = new GrpcContractA2AServer(agentCard);
    const server = new GrpcServer(adapter, agentCard, {
      authenticate(metadata) {
        return metadata.get('authorization')[0] === CONTRACT_AUTHORIZATION;
      },
    });
    const port = await server.bind(0);
    const url = `127.0.0.1:${port}`;
    agentCard.url = `grpc://${url}`;
    agentCard.supportedInterfaces = [
      {
        protocolBinding: 'gRPC',
        protocolVersion: '1.0',
        url: `grpc://${url}`,
      },
    ];
    const client = new GrpcClient(url, {
      metadata: { authorization: CONTRACT_AUTHORIZATION },
    });

    return {
      sendMessage(text, options) {
        return client
          .sendMessage(text, {
            ...(options?.contextId ? { contextId: options.contextId } : {}),
            ...(options?.returnImmediately ? { returnImmediately: true } : {}),
          })
          .then(assertTask);
      },
      async streamMessage(text, options) {
        return client.streamMessage(text, {
          ...(options?.contextId ? { contextId: options.contextId } : {}),
        });
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
      async resubscribeTask(taskId) {
        return client.subscribeTask(taskId);
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
      async sendWithoutAuth() {
        const anonymousClient = new GrpcClient(url);
        try {
          await anonymousClient.sendMessage('unauthorized');
          return { message: 'Authentication was unexpectedly accepted' };
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) };
        } finally {
          anonymousClient.close();
        }
      },
      async negotiateUnsupportedVersion() {
        const unsupportedClient = new GrpcClient(url, {
          protocolVersion: '9.9',
          metadata: { authorization: CONTRACT_AUTHORIZATION },
        });
        try {
          await unsupportedClient.getAgentCard();
          return { message: 'Protocol version was unexpectedly accepted' };
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) };
        } finally {
          unsupportedClient.close();
        }
      },
      async close() {
        client.close();
        await server.close();
      },
    };
  },
});

function assertTask(task: Task | null): Task {
  if (!task) {
    throw new Error('Expected task');
  }
  return task;
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
