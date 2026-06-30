/**
 * @file GrpcServer.ts
 * Experimental gRPC server adapter for A2A Protocol.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { logger, TaskLifecycleError } from '@a2amesh/runtime';
import type {
  A2AServer,
  AgentCard,
  Message,
  Task,
  TaskManager,
  TaskUpdatedEvent,
} from '@a2amesh/runtime';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(currentDirectory, '../proto/a2a.proto');

type EmptyRequest = Record<string, never>;

interface SendMessageRequest {
  message_text?: string;
}

interface TaskRequest {
  task_id: string;
}

interface AgentCardResponse {
  json_card: string;
}

interface TaskResponse {
  task_json: string;
}

const TERMINAL_TASK_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED']);
const A2A_VERSION_METADATA_KEY = 'a2a-version';
const SUPPORTED_A2A_PROTOCOL_VERSIONS = ['1.0', '1.2', '0.3'] as const;

interface ProtoDescriptor {
  a2a: {
    v1: {
      A2AService: {
        service: grpc.ServiceDefinition<grpc.UntypedServiceImplementation>;
      };
    };
  };
}

function toGrpcMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: `grpc-${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
}

export interface GrpcServerOptions {
  supportedProtocolVersions?: readonly string[];
}

function readProtocolVersion(metadata: grpc.Metadata): string | undefined {
  const values = metadata.get(A2A_VERSION_METADATA_KEY);
  const first = values[0];
  if (typeof first === 'string' && first.trim().length > 0) {
    return first.trim();
  }
  if (Buffer.isBuffer(first)) {
    const value = first.toString('utf8').trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function createUnsupportedProtocolVersionError(requestedVersion: string): grpc.ServiceError {
  const message = `A2A protocol version ${requestedVersion} is not supported`;
  return Object.assign(new Error(message), {
    code: grpc.status.FAILED_PRECONDITION,
    details: message,
    metadata: new grpc.Metadata(),
  });
}

export class GrpcServer {
  private readonly server: grpc.Server;
  private readonly agentCard: AgentCard;
  private readonly adapter: A2AServer;

  constructor(
    adapter: A2AServer,
    agentCard: AgentCard,
    private readonly options: GrpcServerOptions = {},
  ) {
    this.server = new grpc.Server();
    this.adapter = adapter;
    this.agentCard = agentCard;

    this.setupServices();
  }

  private setupServices(): void {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(
      packageDefinition,
    ) as unknown as ProtoDescriptor;
    const service = protoDescriptor.a2a.v1.A2AService.service;

    this.server.addService(service, {
      GetAgentCard: (
        call: grpc.ServerUnaryCall<EmptyRequest, AgentCardResponse>,
        callback: grpc.sendUnaryData<AgentCardResponse>,
      ) => {
        if (!this.assertSupportedProtocolVersion(call.metadata, callback)) return;
        callback(null, { json_card: JSON.stringify(this.agentCard) });
      },
      SendMessage: async (
        call: grpc.ServerUnaryCall<SendMessageRequest, TaskResponse>,
        callback: grpc.sendUnaryData<TaskResponse>,
      ) => {
        try {
          if (!this.assertSupportedProtocolVersion(call.metadata, callback)) return;
          const task = this.createGrpcTask(call.request.message_text ?? '');
          callback(null, { task_json: JSON.stringify(task) });
        } catch (error) {
          callback({
            code: grpc.status.INTERNAL,
            details: String(error),
            name: 'GrpcSendMessageError',
          });
        }
      },
      StreamMessage: (call: grpc.ServerWritableStream<SendMessageRequest, TaskResponse>) =>
        this.streamGrpcTask(call),
      GetTask: (
        call: grpc.ServerUnaryCall<TaskRequest, TaskResponse>,
        callback: grpc.sendUnaryData<TaskResponse>,
      ) => {
        if (!this.assertSupportedProtocolVersion(call.metadata, callback)) return;
        const task = this.getTaskManager().getTask(call.request.task_id);
        callback(null, { task_json: JSON.stringify(task ?? null) });
      },
      CancelTask: (
        call: grpc.ServerUnaryCall<TaskRequest, TaskResponse>,
        callback: grpc.sendUnaryData<TaskResponse>,
      ) => {
        if (!this.assertSupportedProtocolVersion(call.metadata, callback)) return;
        const task = this.getTaskManager().cancelTask(call.request.task_id);
        callback(null, { task_json: JSON.stringify(task ?? null) });
      },
    });
  }

  private assertSupportedProtocolVersion<TResponse>(
    metadata: grpc.Metadata,
    callback: grpc.sendUnaryData<TResponse>,
  ): boolean {
    const requestedVersion = readProtocolVersion(metadata);
    if (!requestedVersion) {
      return true;
    }

    if (this.supportedProtocolVersions().includes(requestedVersion)) {
      return true;
    }

    callback(createUnsupportedProtocolVersionError(requestedVersion));
    return false;
  }

  private supportedProtocolVersions(): readonly string[] {
    return this.options.supportedProtocolVersions ?? SUPPORTED_A2A_PROTOCOL_VERSIONS;
  }

  public async bind(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.server.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => {
          if (error) {
            logger.error('Failed to bind gRPC server', { error: String(error) });
            reject(error);
            return;
          }
          logger.info('gRPC Server listening', { port: boundPort });
          resolve(boundPort);
        },
      );
    });
  }

  public async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.tryShutdown((error) => {
        if (error) {
          this.server.forceShutdown();
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private createGrpcTask(messageText: string): Task {
    const taskManager = this.getTaskManager();
    const task = taskManager.createTask();
    const message = toGrpcMessage(messageText);
    taskManager.addHistoryMessage(task.id, message);
    taskManager.updateTaskState(task.id, 'WORKING');
    void this.completeGrpcTask(task, message);

    return taskManager.getTask(task.id) ?? task;
  }

  private async completeGrpcTask(task: Task, message: Message): Promise<void> {
    const taskManager = this.getTaskManager();

    try {
      const artifacts = await this.adapter.handleTask(task, message);
      for (const artifact of artifacts) {
        taskManager.addArtifact(task.id, {
          ...artifact,
          metadata: {
            ...(artifact as { metadata?: Record<string, unknown> }).metadata,
            transport: 'grpc',
            taskId: task.id,
            ...(task.contextId ? { contextId: task.contextId } : {}),
          },
        });
      }
      taskManager.updateTaskState(task.id, 'COMPLETED');
    } catch (error) {
      logger.error('gRPC task processing failed', { taskId: task.id, error });
      try {
        taskManager.updateTaskState(task.id, 'FAILED');
      } catch (lifecycleError) {
        if (
          lifecycleError instanceof TaskLifecycleError &&
          lifecycleError.code === 'TASK_TERMINAL'
        ) {
          return;
        }
        throw lifecycleError;
      }
    }
  }

  private streamGrpcTask(call: grpc.ServerWritableStream<SendMessageRequest, TaskResponse>): void {
    const requestedVersion = readProtocolVersion(call.metadata);
    if (requestedVersion && !this.supportedProtocolVersions().includes(requestedVersion)) {
      call.destroy(createUnsupportedProtocolVersionError(requestedVersion));
      return;
    }

    const task = this.createGrpcTask(call.request.message_text ?? '');
    const taskManager = this.getTaskManager();
    let closed = false;

    const cleanup = () => {
      taskManager.off('taskUpdated', onTaskUpdated);
    };

    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      cleanup();
      call.end();
    };

    const writeTask = (nextTask: Task) => {
      if (closed) {
        return;
      }
      call.write({ task_json: JSON.stringify(nextTask) });
      if (TERMINAL_TASK_STATES.has(nextTask.status.state)) {
        close();
      }
    };

    const onTaskUpdated = ({ task: updatedTask }: TaskUpdatedEvent) => {
      if (updatedTask.id === task.id) {
        writeTask(updatedTask);
      }
    };

    call.on('error', cleanup);
    call.on('close', cleanup);
    taskManager.on('taskUpdated', onTaskUpdated);
    writeTask(taskManager.getTask(task.id) ?? task);
  }

  private getTaskManager(): TaskManager {
    return (this.adapter as A2AServer & { getTaskManager(): TaskManager }).getTaskManager();
  }
}
