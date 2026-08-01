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
  PushNotificationConfig,
  Task,
  TaskManager,
  TaskUpdatedEvent,
} from '@a2amesh/runtime';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(currentDirectory, '../proto/a2a.proto');

type EmptyRequest = Record<string, never>;

interface SendMessageRequest {
  message_text?: string;
  context_id?: string;
  return_immediately?: boolean;
}

interface TaskRequest {
  task_id: string;
}

interface TaskListRequest {
  context_id?: string;
  limit?: number;
  offset?: number;
}

interface PushNotificationConfigRequest {
  task_id: string;
  config_id?: string;
  config_json?: string;
}

interface AgentCardResponse {
  json_card: string;
}

interface HealthResponse {
  health_json: string;
}

interface TaskResponse {
  task_json: string;
}

interface TaskListResponse {
  task_list_json: string;
}

interface PushNotificationConfigResponse {
  config_json: string;
}

interface PushNotificationConfigListResponse {
  config_list_json: string;
}

interface DeletePushNotificationConfigResponse {
  deleted: boolean;
}

const TERMINAL_TASK_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED']);
const A2A_VERSION_METADATA_KEY = 'a2a-version';
const SUPPORTED_A2A_PROTOCOL_VERSIONS = ['1.0', '1.2', '0.3'] as const;
const DEFAULT_PUSH_NOTIFICATION_CONFIG_ID = 'default';

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
  authenticate?: (metadata: grpc.Metadata) => boolean;
  normalizePushNotificationConfig?: (
    config: PushNotificationConfig,
  ) => PushNotificationConfig | Promise<PushNotificationConfig>;
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

function serviceError(code: grpc.status, details: string): grpc.ServiceError {
  return Object.assign(new Error(details), {
    code,
    details,
    metadata: new grpc.Metadata(),
  });
}

function toServiceError(error: unknown, fallback: string): grpc.ServiceError {
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'number' &&
    typeof (error as { details?: unknown }).details === 'string'
  ) {
    return error as grpc.ServiceError;
  }
  if (error instanceof SyntaxError) {
    return serviceError(grpc.status.INVALID_ARGUMENT, 'Invalid JSON payload');
  }
  if (error instanceof TaskLifecycleError) {
    return serviceError(grpc.status.FAILED_PRECONDITION, error.message);
  }
  return serviceError(grpc.status.INTERNAL, error instanceof Error ? error.message : fallback);
}

export class GrpcServer {
  private readonly server: grpc.Server;
  private readonly agentCard: AgentCard;
  private readonly adapter: A2AServer;
  private readonly startedAt = Date.now();

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
        void this.handleUnary(call.metadata, callback, () => ({
          json_card: JSON.stringify(this.agentCard),
        }));
      },
      GetAuthenticatedExtendedCard: (
        call: grpc.ServerUnaryCall<EmptyRequest, AgentCardResponse>,
        callback: grpc.sendUnaryData<AgentCardResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => {
          if (!this.options.authenticate) {
            throw serviceError(
              grpc.status.UNAUTHENTICATED,
              'Authenticated extended card requires authentication',
            );
          }
          if (!this.agentCard.capabilities?.extendedAgentCard) {
            throw serviceError(grpc.status.UNIMPLEMENTED, 'Extended card not supported');
          }
          return { json_card: JSON.stringify(this.agentCard) };
        });
      },
      Health: (
        call: grpc.ServerUnaryCall<EmptyRequest, HealthResponse>,
        callback: grpc.sendUnaryData<HealthResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => ({
          health_json: JSON.stringify(this.healthResponse()),
        }));
      },
      SendMessage: (
        call: grpc.ServerUnaryCall<SendMessageRequest, TaskResponse>,
        callback: grpc.sendUnaryData<TaskResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => {
          const task = this.createGrpcTask(
            call.request.message_text ?? '',
            call.request.context_id,
          );
          return { task_json: JSON.stringify(task) };
        });
      },
      StreamMessage: (call: grpc.ServerWritableStream<SendMessageRequest, TaskResponse>) => {
        const requestError = this.requestError(call.metadata);
        if (requestError) {
          call.destroy(requestError);
          return;
        }
        try {
          const task = this.createGrpcTask(
            call.request.message_text ?? '',
            call.request.context_id,
          );
          this.streamTask(call, task);
        } catch (error) {
          call.destroy(toServiceError(error, 'Unable to stream message'));
        }
      },
      GetTask: (
        call: grpc.ServerUnaryCall<TaskRequest, TaskResponse>,
        callback: grpc.sendUnaryData<TaskResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => ({
          task_json: JSON.stringify(this.getTaskManager().getTask(call.request.task_id) ?? null),
        }));
      },
      ListTasks: (
        call: grpc.ServerUnaryCall<TaskListRequest, TaskListResponse>,
        callback: grpc.sendUnaryData<TaskListResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => ({
          task_list_json: JSON.stringify(this.listTasks(call.request)),
        }));
      },
      CancelTask: (
        call: grpc.ServerUnaryCall<TaskRequest, TaskResponse>,
        callback: grpc.sendUnaryData<TaskResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => ({
          task_json: JSON.stringify(this.getTaskManager().cancelTask(call.request.task_id) ?? null),
        }));
      },
      SubscribeTask: (call: grpc.ServerWritableStream<TaskRequest, TaskResponse>) => {
        const requestError = this.requestError(call.metadata);
        if (requestError) {
          call.destroy(requestError);
          return;
        }
        const task = this.getTaskManager().getTask(call.request.task_id);
        if (!task) {
          call.destroy(serviceError(grpc.status.NOT_FOUND, 'Task not found'));
          return;
        }
        this.streamTask(call, task);
      },
      CreatePushNotificationConfig: (
        call: grpc.ServerUnaryCall<PushNotificationConfigRequest, PushNotificationConfigResponse>,
        callback: grpc.sendUnaryData<PushNotificationConfigResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, async () => {
          const task = this.requireTask(call.request.task_id);
          const parsed = parsePushNotificationConfig(call.request.config_json);
          const config = this.options.normalizePushNotificationConfig
            ? await this.options.normalizePushNotificationConfig(parsed)
            : parsed;
          const configId = normalizeConfigId(call.request.config_id, config);
          const stored = this.getTaskManager().setPushNotificationConfig(task.id, configId, config);
          return { config_json: JSON.stringify(stored ?? null) };
        });
      },
      GetPushNotificationConfig: (
        call: grpc.ServerUnaryCall<PushNotificationConfigRequest, PushNotificationConfigResponse>,
        callback: grpc.sendUnaryData<PushNotificationConfigResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => {
          const task = this.requireTask(call.request.task_id);
          const config = this.getTaskManager().getPushNotificationConfig(
            task.id,
            normalizeConfigId(call.request.config_id),
          );
          return { config_json: JSON.stringify(config ?? null) };
        });
      },
      ListPushNotificationConfigs: (
        call: grpc.ServerUnaryCall<TaskRequest, PushNotificationConfigListResponse>,
        callback: grpc.sendUnaryData<PushNotificationConfigListResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => {
          const task = this.requireTask(call.request.task_id);
          return {
            config_list_json: JSON.stringify({
              configs: this.getTaskManager().listPushNotifications(task.id),
            }),
          };
        });
      },
      DeletePushNotificationConfig: (
        call: grpc.ServerUnaryCall<
          PushNotificationConfigRequest,
          DeletePushNotificationConfigResponse
        >,
        callback: grpc.sendUnaryData<DeletePushNotificationConfigResponse>,
      ) => {
        void this.handleUnary(call.metadata, callback, () => {
          const task = this.requireTask(call.request.task_id);
          return {
            deleted: this.getTaskManager().removePushNotificationConfig(
              task.id,
              normalizeConfigId(call.request.config_id),
            ),
          };
        });
      },
    });
  }

  private async handleUnary<TResponse>(
    metadata: grpc.Metadata,
    callback: grpc.sendUnaryData<TResponse>,
    operation: () => TResponse | Promise<TResponse>,
  ): Promise<void> {
    const requestError = this.requestError(metadata);
    if (requestError) {
      callback(requestError);
      return;
    }
    try {
      callback(null, await operation());
    } catch (error) {
      callback(toServiceError(error, 'gRPC operation failed'));
    }
  }

  private requestError(metadata: grpc.Metadata): grpc.ServiceError | undefined {
    const requestedVersion = readProtocolVersion(metadata);
    if (requestedVersion && !this.supportedProtocolVersions().includes(requestedVersion)) {
      return serviceError(
        grpc.status.FAILED_PRECONDITION,
        `A2A protocol version ${requestedVersion} is not supported`,
      );
    }

    if (this.options.authenticate) {
      try {
        if (!this.options.authenticate(metadata)) {
          return serviceError(grpc.status.UNAUTHENTICATED, 'Authentication required');
        }
      } catch {
        return serviceError(grpc.status.UNAUTHENTICATED, 'Authentication required');
      }
    }
    return undefined;
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

  private createGrpcTask(messageText: string, contextId?: string): Task {
    const taskManager = this.getTaskManager();
    const task = taskManager.createTask(undefined, contextId || undefined);
    const message = toGrpcMessage(messageText);
    if (contextId) {
      message.contextId = contextId;
    }
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

  private streamTask(
    call: grpc.ServerWritableStream<SendMessageRequest | TaskRequest, TaskResponse>,
    task: Task,
  ): void {
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
    call.on('cancelled', cleanup);
    taskManager.on('taskUpdated', onTaskUpdated);
    writeTask(taskManager.getTask(task.id) ?? task);
  }

  private listTasks(request: TaskListRequest): { tasks: Task[]; total: number } {
    const contextId = request.context_id?.trim();
    const limit = request.limit && request.limit > 0 ? request.limit : 50;
    const offset = request.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw serviceError(grpc.status.INVALID_ARGUMENT, 'limit must be between 1 and 1000');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw serviceError(grpc.status.INVALID_ARGUMENT, 'offset must be a non-negative integer');
    }
    const tasks = contextId
      ? this.getTaskManager().getTasksByContext(contextId)
      : this.getTaskManager().getAllTasks();
    return { tasks: tasks.slice(offset, offset + limit), total: tasks.length };
  }

  private requireTask(taskId: string): Task {
    if (!taskId.trim()) {
      throw serviceError(grpc.status.INVALID_ARGUMENT, 'task_id is required');
    }
    const task = this.getTaskManager().getTask(taskId);
    if (!task) {
      throw serviceError(grpc.status.NOT_FOUND, 'Task not found');
    }
    return task;
  }

  private healthResponse() {
    const counts = this.getTaskManager().getTaskCounts();
    const memory = process.memoryUsage();
    return {
      status: 'healthy',
      version: this.agentCard.version,
      protocol: 'A2A/1.0',
      uptime: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      tasks: {
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        total: counts.total,
      },
      memory: {
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      },
    } as const;
  }

  private getTaskManager(): TaskManager {
    return (this.adapter as A2AServer & { getTaskManager(): TaskManager }).getTaskManager();
  }
}

function normalizeConfigId(
  value: string | undefined,
  config?: Pick<PushNotificationConfig, 'id'>,
): string {
  const selected = value?.trim() || config?.id?.trim();
  return selected || DEFAULT_PUSH_NOTIFICATION_CONFIG_ID;
}

function parsePushNotificationConfig(value: string | undefined): PushNotificationConfig {
  if (!value) {
    throw serviceError(grpc.status.INVALID_ARGUMENT, 'config_json is required');
  }
  const parsed = JSON.parse(value) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { url?: unknown }).url !== 'string' ||
    !(parsed as { url: string }).url.trim()
  ) {
    throw serviceError(grpc.status.INVALID_ARGUMENT, 'Push notification config requires a URL');
  }
  return parsed as PushNotificationConfig;
}
