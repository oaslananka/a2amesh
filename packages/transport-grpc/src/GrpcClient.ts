import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { AgentCard, Task } from '@a2amesh/runtime';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(currentDirectory, '../proto/a2a.proto');

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

interface TaskResponse {
  task_json: string;
}

interface TaskRequest {
  task_id: string;
}

interface SendMessageRequest {
  message_text: string;
}

interface GrpcClientLike extends grpc.Client {
  GetAgentCard(
    request: Record<string, never>,
    callback: (error: grpc.ServiceError | null, response: AgentCardResponse) => void,
  ): void;
  GetAgentCard(
    request: Record<string, never>,
    metadata: grpc.Metadata,
    callback: (error: grpc.ServiceError | null, response: AgentCardResponse) => void,
  ): void;
  SendMessage(
    request: SendMessageRequest,
    callback: (error: grpc.ServiceError | null, response: TaskResponse) => void,
  ): void;
  SendMessage(
    request: SendMessageRequest,
    metadata: grpc.Metadata,
    callback: (error: grpc.ServiceError | null, response: TaskResponse) => void,
  ): void;
  StreamMessage(request: SendMessageRequest): grpc.ClientReadableStream<TaskResponse>;
  StreamMessage(
    request: SendMessageRequest,
    metadata: grpc.Metadata,
  ): grpc.ClientReadableStream<TaskResponse>;
  GetTask(
    request: TaskRequest,
    callback: (error: grpc.ServiceError | null, response: TaskResponse) => void,
  ): void;
  GetTask(
    request: TaskRequest,
    metadata: grpc.Metadata,
    callback: (error: grpc.ServiceError | null, response: TaskResponse) => void,
  ): void;
  CancelTask(
    request: TaskRequest,
    callback: (error: grpc.ServiceError | null, response: TaskResponse) => void,
  ): void;
  CancelTask(
    request: TaskRequest,
    metadata: grpc.Metadata,
    callback: (error: grpc.ServiceError | null, response: TaskResponse) => void,
  ): void;
}

export interface GrpcClientOptions {
  protocolVersion?: string;
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
    return new Promise<AgentCard>((resolve, reject) => {
      const callback = (error: grpc.ServiceError | null, response: AgentCardResponse) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(JSON.parse(response.json_card) as AgentCard);
      };
      const metadata = this.callMetadata();
      if (metadata) {
        this.client.GetAgentCard({}, metadata, callback);
      } else {
        this.client.GetAgentCard({}, callback);
      }
    });
  }

  async sendMessage(messageText: string): Promise<Task | null> {
    return new Promise<Task | null>((resolve, reject) => {
      const request = { message_text: messageText };
      const callback = (error: grpc.ServiceError | null, response: TaskResponse) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(JSON.parse(response.task_json) as Task | null);
      };
      const metadata = this.callMetadata();
      if (metadata) {
        this.client.SendMessage(request, metadata, callback);
      } else {
        this.client.SendMessage(request, callback);
      }
    });
  }

  async *streamMessage(messageText: string): AsyncGenerator<Task> {
    const request = { message_text: messageText };
    const metadata = this.callMetadata();
    const call = metadata
      ? this.client.StreamMessage(request, metadata)
      : this.client.StreamMessage(request);
    const queue: Task[] = [];
    let finished = false;
    let streamError: Error | undefined;
    let wake: (() => void) | undefined;

    const notify = () => {
      wake?.();
      wake = undefined;
    };

    call.on('data', (response) => {
      queue.push(JSON.parse(response.task_json) as Task);
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
  }

  async getTask(taskId: string): Promise<Task | null> {
    return new Promise<Task | null>((resolve, reject) => {
      const request = { task_id: taskId };
      const callback = (error: grpc.ServiceError | null, response: TaskResponse) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(JSON.parse(response.task_json) as Task | null);
      };
      const metadata = this.callMetadata();
      if (metadata) {
        this.client.GetTask(request, metadata, callback);
      } else {
        this.client.GetTask(request, callback);
      }
    });
  }

  async cancelTask(taskId: string): Promise<Task | null> {
    return new Promise<Task | null>((resolve, reject) => {
      const request = { task_id: taskId };
      const callback = (error: grpc.ServiceError | null, response: TaskResponse) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(JSON.parse(response.task_json) as Task | null);
      };
      const metadata = this.callMetadata();
      if (metadata) {
        this.client.CancelTask(request, metadata, callback);
      } else {
        this.client.CancelTask(request, callback);
      }
    });
  }

  private callMetadata(): grpc.Metadata | undefined {
    if (!this.options.protocolVersion) {
      return undefined;
    }

    const metadata = new grpc.Metadata();
    metadata.set('a2a-version', this.options.protocolVersion);
    return metadata;
  }

  close(): void {
    this.client.close();
  }
}
