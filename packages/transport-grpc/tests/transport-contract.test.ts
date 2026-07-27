import type { Artifact, Message, Task } from '@a2amesh/runtime';
import { A2AServer, type AgentCard } from '@a2amesh/runtime';
import { GrpcClient } from '../src/GrpcClient.js';
import { GrpcServer } from '../src/GrpcServer.js';
import {
  runTransportContract,
  type TransportCapabilityMap,
} from '../../../tests/transport-contract/transportContract.js';

const GRPC_CAPABILITIES: TransportCapabilityMap = {
  sendMessage: { supported: true },
  streamMessage: { supported: true },
  getTask: { supported: true },
  cancelTask: { supported: true },
  resolveCard: { supported: true },
  health: {
    supported: false,
    reason: 'gRPC Contract Agent proto does not define a Health RPC for gRPC.',
  },
  authErrors: {
    supported: false,
    reason:
      'gRPC Contract Agent proto does not define authentication metadata requirements for gRPC.',
  },
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
    const server = new GrpcServer(adapter, agentCard);
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
    const client = new GrpcClient(url);

    return {
      async sendMessage(text, options) {
        const task = await client.sendMessage(text);
        applyContext(adapter, task, options?.contextId);
        return assertTask(task);
      },
      async streamMessage(text, options) {
        const stream = client.streamMessage(text);
        if (!options?.contextId) {
          return stream;
        }

        return (async function* streamWithContext(): AsyncGenerator<Task> {
          for await (const task of stream) {
            applyContext(adapter, task, options.contextId);
            yield task;
          }
        })();
      },
      getTask(taskId) {
        return client.getTask(taskId);
      },
      cancelTask(taskId) {
        return client.cancelTask(taskId);
      },
      resolveCard() {
        return client.getAgentCard();
      },
      async negotiateUnsupportedVersion() {
        const unsupportedClient = new GrpcClient(url, { protocolVersion: '9.9' });
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

function applyContext(
  adapter: GrpcContractA2AServer,
  task: Task | null,
  contextId: string | undefined,
): void {
  if (!task || !contextId) {
    return;
  }
  task.contextId = contextId;
  const storedTask = adapter.getTaskManager().getTask(task.id);
  if (storedTask) {
    storedTask.contextId = contextId;
  }
}

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
