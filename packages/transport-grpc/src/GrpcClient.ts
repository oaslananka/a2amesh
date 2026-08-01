import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type {
  A2AHealthResponse,
  AgentCard,
  PushNotificationConfig,
  Task,
  TaskListParams,
  TaskListResult,
} from '@a2amesh/runtime';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(currentDirectory, '../proto/a2a.proto');

type EmptyRequest = Record<string, never>;
type UnaryCallback<TResponse> = (error: grpc.ServiceError | null, response: TResponse) => void;
type UnaryMethod<TRequest, TResponse> = {
  (request: TRequest, callback: UnaryCallback<TResponse>): void;
  (request: TRequest, metadata: grpc.Metadata, callback: UnaryCallback<TResponse>): void;
};
type StreamMethod<TRequest, TResponse> = {
  (request: TRequest): grpc.ClientReadableStream<TResponse>;
  (request: TRequest, metadata: grpc.Metadata): grpc.ClientReadableStream<TResponse>;
};

interface ProtoDescriptor {
  a2a: {
    v1: {
      A2AService: grpc.ServiceClientConstructor;
    };
  };
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

interface TaskRequest {
  task_id: string;
}

interface TaskListRequest {
  context_id?: string;
  limit?: number;
  offset?: number;
}

interface SendMessageRequest {
  message_text: string;
  context_id?: string;
  return_immediately?: boolean;
}

interface PushNotificationConfigRequest {
  task_id: string;
  config_id?: string;
  config_json?: string;
}

interface GrpcClientLike extends grpc.Client {
  GetAgentCard: UnaryMethod<EmptyRequest, AgentCardResponse>;
  GetAuthenticatedExtendedCard: UnaryMethod<EmptyRequest, AgentCardResponse>;
  Health: UnaryMethod<EmptyRequest, HealthResponse>;
  SendMessage: UnaryMethod<SendMessageRequest, TaskResponse>;
  StreamMessage: StreamMethod<SendMessageRequest, TaskResponse>;
  GetTask: UnaryMethod<TaskRequest, TaskResponse>;
  ListTasks: UnaryMethod<TaskListRequest, TaskListResponse>;
  CancelTask: UnaryMethod<TaskRequest, TaskResponse>;
  SubscribeTask: StreamMethod<TaskRequest, TaskResponse>;
  CreatePushNotificationConfig: UnaryMethod<
    PushNotificationConfigRequest,
    PushNotificationConfigResponse
  >;
  GetPushNotificationConfig: UnaryMethod<
    PushNotificationConfigRequest,
    PushNotificationConfigResponse
  >;
  ListPushNotificationConfigs: UnaryMethod<TaskRequest, PushNotificationConfigListResponse>;
  DeletePushNotificationConfig: UnaryMethod<
    PushNotificationConfigRequest,
    DeletePushNotificationConfigResponse
  >;
}

export interface GrpcSendMessageOptions {
  contextId?: string;
  returnImmediately?: boolean;
}

export interface GrpcClientOptions {
  protocolVersion?: string;
  metadata?: Record<string, string>;
}

export class GrpcClient {
  private readonly client: GrpcClientLike;

  constructor(
    address: string,
    private readonly options: GrpcClientOptions = {},
  ) {
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
    const ClientConstructor = protoDescriptor.a2a.v1.A2AService;
    this.client = new ClientConstructor(
      address,
      grpc.credentials.createInsecure(),
    ) as unknown as GrpcClientLike;
  }

  async getAgentCard(): Promise<AgentCard> {
    const response = await this.unary<EmptyRequest, AgentCardResponse>(
      this.client.GetAgentCard.bind(this.client),
      {},
    );
    return parseJson<AgentCard>(response.json_card);
  }

  async getAuthenticatedExtendedCard(): Promise<AgentCard> {
    const response = await this.unary<EmptyRequest, AgentCardResponse>(
      this.client.GetAuthenticatedExtendedCard.bind(this.client),
      {},
    );
    return parseJson<AgentCard>(response.json_card);
  }

  async health(): Promise<A2AHealthResponse> {
    const response = await this.unary<EmptyRequest, HealthResponse>(
      this.client.Health.bind(this.client),
      {},
    );
    return parseJson<A2AHealthResponse>(response.health_json);
  }

  async sendMessage(
    messageText: string,
    options: GrpcSendMessageOptions = {},
  ): Promise<Task | null> {
    const response = await this.unary<SendMessageRequest, TaskResponse>(
      this.client.SendMessage.bind(this.client),
      createSendMessageRequest(messageText, options),
    );
    return parseJson<Task | null>(response.task_json);
  }

  streamMessage(messageText: string, options: GrpcSendMessageOptions = {}): AsyncGenerator<Task> {
    return this.taskStream(
      this.client.StreamMessage.bind(this.client),
      createSendMessageRequest(messageText, options),
    );
  }

  async getTask(taskId: string): Promise<Task | null> {
    const response = await this.unary<TaskRequest, TaskResponse>(
      this.client.GetTask.bind(this.client),
      { task_id: taskId },
    );
    return parseJson<Task | null>(response.task_json);
  }

  async listTasks(params: TaskListParams = {}): Promise<TaskListResult> {
    const response = await this.unary<TaskListRequest, TaskListResponse>(
      this.client.ListTasks.bind(this.client),
      {
        ...(params.contextId ? { context_id: params.contextId } : {}),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
      },
    );
    return parseJson<TaskListResult>(response.task_list_json);
  }

  async cancelTask(taskId: string): Promise<Task | null> {
    const response = await this.unary<TaskRequest, TaskResponse>(
      this.client.CancelTask.bind(this.client),
      { task_id: taskId },
    );
    return parseJson<Task | null>(response.task_json);
  }

  subscribeTask(taskId: string): AsyncGenerator<Task> {
    return this.taskStream(this.client.SubscribeTask.bind(this.client), { task_id: taskId });
  }

  async createPushNotificationConfig(
    taskId: string,
    config: PushNotificationConfig,
    configId = config.id,
  ): Promise<PushNotificationConfig | null> {
    const response = await this.unary<
      PushNotificationConfigRequest,
      PushNotificationConfigResponse
    >(this.client.CreatePushNotificationConfig.bind(this.client), {
      task_id: taskId,
      ...(configId ? { config_id: configId } : {}),
      config_json: JSON.stringify(config),
    });
    return parseJson<PushNotificationConfig | null>(response.config_json);
  }

  async getPushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<PushNotificationConfig | null> {
    const response = await this.unary<
      PushNotificationConfigRequest,
      PushNotificationConfigResponse
    >(this.client.GetPushNotificationConfig.bind(this.client), {
      task_id: taskId,
      config_id: configId,
    });
    return parseJson<PushNotificationConfig | null>(response.config_json);
  }

  async listPushNotificationConfigs(
    taskId: string,
  ): Promise<{ configs: PushNotificationConfig[] }> {
    const response = await this.unary<TaskRequest, PushNotificationConfigListResponse>(
      this.client.ListPushNotificationConfigs.bind(this.client),
      { task_id: taskId },
    );
    return parseJson<{ configs: PushNotificationConfig[] }>(response.config_list_json);
  }

  async deletePushNotificationConfig(
    taskId: string,
    configId = 'default',
  ): Promise<{ deleted: boolean }> {
    const response = await this.unary<
      PushNotificationConfigRequest,
      DeletePushNotificationConfigResponse
    >(this.client.DeletePushNotificationConfig.bind(this.client), {
      task_id: taskId,
      config_id: configId,
    });
    return { deleted: response.deleted };
  }

  close(): void {
    this.client.close();
  }

  private async unary<TRequest, TResponse>(
    method: UnaryMethod<TRequest, TResponse>,
    request: TRequest,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      const callback: UnaryCallback<TResponse> = (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      };
      const metadata = this.callMetadata();
      if (metadata) {
        method(request, metadata, callback);
      } else {
        method(request, callback);
      }
    });
  }

  private async *taskStream<TRequest>(
    method: StreamMethod<TRequest, TaskResponse>,
    request: TRequest,
  ): AsyncGenerator<Task> {
    const metadata = this.callMetadata();
    const call = metadata ? method(request, metadata) : method(request);
    const queue: Task[] = [];
    let finished = false;
    let streamError: Error | undefined;
    let wake: (() => void) | undefined;

    const notify = () => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };

    call.on('data', (response) => {
      try {
        queue.push(parseJson<Task>(response.task_json));
      } catch (error) {
        streamError = error instanceof Error ? error : new Error(String(error));
        finished = true;
        call.cancel();
      }
      notify();
    });
    call.on('error', (error) => {
      streamError = error;
      finished = true;
      notify();
    });
    call.on('end', () => {
      finished = true;
      notify();
    });

    try {
      while (!finished || queue.length > 0) {
        const task = queue.shift();
        if (task) {
          yield task;
          continue;
        }

        if (streamError) {
          throw streamError;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      if (streamError) {
        throw streamError;
      }
    } finally {
      call.removeAllListeners();
    }
  }

  private callMetadata(): grpc.Metadata | undefined {
    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(this.options.metadata ?? {})) {
      metadata.set(key, value);
    }
    if (this.options.protocolVersion) {
      metadata.set('a2a-version', this.options.protocolVersion);
    }
    return metadata.getMap() && Object.keys(metadata.getMap()).length > 0 ? metadata : undefined;
  }
}

function createSendMessageRequest(
  messageText: string,
  options: GrpcSendMessageOptions,
): SendMessageRequest {
  return {
    message_text: messageText,
    ...(options.contextId ? { context_id: options.contextId } : {}),
    ...(options.returnImmediately !== undefined
      ? { return_immediately: options.returnImmediately }
      : {}),
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
