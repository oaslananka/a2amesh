import { EventEmitter } from 'node:events';
import {
  A2AServer,
  type AgentCard,
  type Artifact,
  type Message,
  type Task,
} from '@a2amesh/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrpcClient } from '../src/GrpcClient.js';
import { GrpcServer } from '../src/GrpcServer.js';

class EchoA2AServer extends A2AServer {
  constructor(agentCard = createAgentCard()) {
    super(agentCard, { allowUnresolvedHostnames: true });
  }

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    await delay(5);
    return [
      {
        artifactId: `artifact-${task.id}`,
        parts: [{ type: 'text', text: `grpc:${readText(message)}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

class RejectingA2AServer extends EchoA2AServer {
  override async handleTask(): Promise<Artifact[]> {
    throw new Error('agent failed');
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('@grpc/proto-loader');
  vi.resetModules();
});

describe('gRPC transport package', () => {
  it('round-trips messages through core task lifecycle behavior', async () => {
    const session = await createGrpcSession();

    try {
      const submittedTask = await session.client.sendMessage('unit-success');

      expect(submittedTask?.status.state).toBe('WORKING');
      expect(submittedTask?.history[0]?.parts).toEqual([{ type: 'text', text: 'unit-success' }]);

      const completedTask = await waitForCompletedTask(
        session.client,
        assertTask(submittedTask).id,
      );

      expect(completedTask.status.state).toBe('COMPLETED');
      expect(completedTask.history[0]?.role).toBe('ROLE_USER');
      expect(completedTask.artifacts?.[0]?.parts).toEqual([
        { type: 'text', text: 'grpc:unit-success' },
      ]);
      expect(completedTask.artifacts?.[0]?.metadata).toMatchObject({
        transport: 'grpc',
        taskId: completedTask.id,
      });
    } finally {
      await session.close();
    }
  });

  it('marks tasks failed when adapter processing rejects', async () => {
    const session = await createGrpcSession(new RejectingA2AServer());

    try {
      const submittedTask = await session.client.sendMessage('unit-failure');
      const failedTask = await waitForTaskState(
        session.client,
        assertTask(submittedTask).id,
        'FAILED',
      );

      expect(failedTask.status.state).toBe('FAILED');
      expect(failedTask.history[0]?.parts).toEqual([{ type: 'text', text: 'unit-failure' }]);
      expect(failedTask.artifacts ?? []).toHaveLength(0);
    } finally {
      await session.close();
    }
  });

  it('returns null for invalid task identifiers without mutating task state', async () => {
    const session = await createGrpcSession();

    try {
      await expect(session.client.getTask('missing-task')).resolves.toBeNull();
      await expect(session.client.cancelTask('missing-task')).resolves.toBeNull();
      expect(session.adapter.getTaskManager().getTaskCounts().total).toBe(0);
    } finally {
      await session.close();
    }
  });

  it('surfaces server-side invalid payload handling as gRPC errors', async () => {
    const adapter = new EchoA2AServer();
    vi.spyOn(adapter, 'getTaskManager').mockImplementation(() => {
      throw new Error('task manager unavailable');
    });
    const session = await createGrpcSession(adapter);

    try {
      await expect(session.client.sendMessage('invalid-server-payload')).rejects.toThrow(
        /task manager unavailable/u,
      );
    } finally {
      await session.close();
    }
  });

  it('rejects invalid JSON payloads returned by unary client calls', async () => {
    const client = new GrpcClient('127.0.0.1:1');
    const close = vi.fn();
    replaceInnerClient(client, {
      GetTask: (_request: unknown, callback: UnaryCallback) => {
        callback(null, { task_json: '{not-json' });
      },
      close,
    });

    await expect(client.getTask('task-1')).rejects.toThrow(SyntaxError);

    client.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects unary client service errors', async () => {
    const serviceError = new Error('grpc unavailable');
    const client = new GrpcClient('127.0.0.1:1');
    replaceInnerClient(client, {
      GetAgentCard: (_request: unknown, callback: UnaryCallback) => callback(serviceError),
      SendMessage: (_request: unknown, callback: UnaryCallback) => callback(serviceError),
      GetTask: (_request: unknown, callback: UnaryCallback) => callback(serviceError),
      CancelTask: (_request: unknown, callback: UnaryCallback) => callback(serviceError),
      close: vi.fn(),
    });

    await expect(client.getAgentCard()).rejects.toThrow('grpc unavailable');
    await expect(client.sendMessage('hello')).rejects.toThrow('grpc unavailable');
    await expect(client.getTask('task-1')).rejects.toThrow('grpc unavailable');
    await expect(client.cancelTask('task-1')).rejects.toThrow('grpc unavailable');
  });

  it('propagates stream client errors after listeners are attached', async () => {
    const serviceError = new Error('stream unavailable');
    const stream = new EventEmitter();
    const client = new GrpcClient('127.0.0.1:1');
    replaceInnerClient(client, {
      StreamMessage: () => stream,
      close: vi.fn(),
    });

    const next = client.streamMessage('hello').next();
    queueMicrotask(() => stream.emit('error', serviceError));

    await expect(next).rejects.toThrow('stream unavailable');
  });

  it('rejects bind failures and force-closes shutdown failures', async () => {
    const server = new GrpcServer(new EchoA2AServer(), createAgentCard());
    const innerServer = getInnerServer(server);
    const bindError = new Error('bind failed');
    const shutdownError = new Error('shutdown failed');
    const forceShutdown = vi.spyOn(innerServer, 'forceShutdown');

    vi.spyOn(innerServer, 'bindAsync').mockImplementation(
      (_address: string, _credentials: unknown, callback: BindCallback) => {
        callback(bindError, 0);
      },
    );
    vi.spyOn(innerServer, 'tryShutdown').mockImplementation((callback: ShutdownCallback) => {
      callback(shutdownError);
    });

    await expect(server.bind(0)).rejects.toThrow('bind failed');
    await expect(server.close()).rejects.toThrow('shutdown failed');
    expect(forceShutdown).toHaveBeenCalledTimes(1);
  });

  it('surfaces protobuf loading errors from client construction', async () => {
    vi.doMock('@grpc/proto-loader', () => ({
      loadSync: vi.fn(() => {
        throw new Error('client proto failed');
      }),
    }));

    const { GrpcClient: BrokenGrpcClient } = await import('../src/GrpcClient.js');

    expect(() => new BrokenGrpcClient('127.0.0.1:1')).toThrow('client proto failed');
  });

  it('surfaces protobuf loading errors from server construction', async () => {
    vi.doMock('@grpc/proto-loader', () => ({
      loadSync: vi.fn(() => {
        throw new Error('server proto failed');
      }),
    }));

    const { GrpcServer: BrokenGrpcServer } = await import('../src/GrpcServer.js');

    expect(() => new BrokenGrpcServer(new EchoA2AServer(), createAgentCard())).toThrow(
      'server proto failed',
    );
  });

  it('rejects unary calls that request an unsupported A2A protocol version', async () => {
    const session = await createGrpcSession();
    const client = new GrpcClient(session.address, { protocolVersion: '9.9' });

    try {
      await expect(client.getAgentCard()).rejects.toThrow(
        'A2A protocol version 9.9 is not supported',
      );
    } finally {
      client.close();
      await session.close();
    }
  });
});

interface GrpcSession {
  address: string;
  adapter: EchoA2AServer;
  client: GrpcClient;
  server: GrpcServer;
  close(): Promise<void>;
}

type UnaryCallback = (error: Error | null, response?: Record<string, string>) => void;
type BindCallback = (error: Error | null, boundPort: number) => void;
type ShutdownCallback = (error?: Error) => void;

async function createGrpcSession(adapter = new EchoA2AServer()): Promise<GrpcSession> {
  const agentCard = adapter.getAgentCard();
  const server = new GrpcServer(adapter, agentCard);
  const port = await server.bind(0);
  const address = `127.0.0.1:${port}`;
  agentCard.url = `grpc://${address}`;
  agentCard.supportedInterfaces = [
    {
      protocolBinding: 'gRPC',
      protocolVersion: '1.0',
      url: `grpc://${address}`,
    },
  ];
  const client = new GrpcClient(address);

  return {
    address,
    adapter,
    client,
    server,
    async close() {
      client.close();
      await server.close();
    },
  };
}

function createAgentCard(): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'gRPC Unit Agent',
    description: 'gRPC unit test agent',
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
}

function replaceInnerClient(client: GrpcClient, innerClient: Record<string, unknown>): void {
  (client as unknown as { client: Record<string, unknown> }).client = innerClient;
}

function getInnerServer(server: GrpcServer): {
  bindAsync(
    address: string,
    credentials: unknown,
    callback: (error: Error | null, boundPort: number) => void,
  ): void;
  tryShutdown(callback: (error?: Error) => void): void;
  forceShutdown(): void;
} {
  return (
    server as unknown as {
      server: {
        bindAsync(
          address: string,
          credentials: unknown,
          callback: (error: Error | null, boundPort: number) => void,
        ): void;
        tryShutdown(callback: (error?: Error) => void): void;
        forceShutdown(): void;
      };
    }
  ).server;
}

async function waitForCompletedTask(client: GrpcClient, taskId: string): Promise<Task> {
  return waitForTaskState(client, taskId, 'COMPLETED');
}

async function waitForTaskState(
  client: GrpcClient,
  taskId: string,
  state: Task['status']['state'],
): Promise<Task> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const task = await client.getTask(taskId);
    if (task?.status.state === state) {
      return task;
    }
    await delay(10);
  }

  throw new Error(`Task ${taskId} did not reach ${state}`);
}

function assertTask(task: Task | null): Task {
  if (!task) {
    throw new Error('Expected task');
  }
  return task;
}

function readText(message: Message): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
