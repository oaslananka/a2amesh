import type { Artifact, Message, MessageSendParams, Task, TaskState } from '../types/task.js';
import { normalizeMessageRole, normalizeTaskState } from './compat.js';

type JsonRecord = Record<string, unknown>;
type InternalPart = Message['parts'][number];

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function officialTaskState(state: TaskState): string {
  return `TASK_STATE_${state}`;
}

function bytesToBase64(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return undefined;
}

function officialFilePart(
  part: JsonRecord,
  content: { bytes?: string; uri?: string },
): InternalPart {
  const name = nonEmptyString(part['filename']);
  return {
    type: 'file',
    file: {
      ...(name ? { name } : {}),
      mimeType: nonEmptyString(part['mediaType']) ?? 'application/octet-stream',
      ...content,
    },
  };
}

function normalizeInMemoryContent(part: JsonRecord): InternalPart | undefined {
  const content = part['content'];
  if (!isRecord(content)) return undefined;
  const caseName = content['$case'];
  const value = content['value'];
  if (caseName === 'text' && typeof value === 'string') {
    return { type: 'text', text: value };
  }
  if (caseName === 'url' && typeof value === 'string') {
    return officialFilePart(part, { uri: value });
  }
  if (caseName === 'raw') {
    const bytes = bytesToBase64(value);
    return bytes ? officialFilePart(part, { bytes }) : undefined;
  }
  if (caseName === 'data' && isRecord(value)) {
    return { type: 'data', data: value };
  }
  return undefined;
}

export function normalizeOfficialPartInput(value: unknown): unknown {
  if (!isRecord(value) || typeof value['type'] === 'string') return value;

  const inMemory = normalizeInMemoryContent(value);
  if (inMemory) return inMemory;

  if (typeof value['text'] === 'string') {
    return { type: 'text', text: value['text'] } satisfies InternalPart;
  }
  if (typeof value['url'] === 'string') {
    return officialFilePart(value, { uri: value['url'] });
  }
  if (typeof value['raw'] === 'string') {
    return officialFilePart(value, { bytes: value['raw'] });
  }
  if (isRecord(value['data'])) {
    return { type: 'data', data: value['data'] } satisfies InternalPart;
  }
  return value;
}

export function normalizeOfficialMessageInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const parts = Array.isArray(value['parts'])
    ? value['parts'].map((part) => normalizeOfficialPartInput(part))
    : value['parts'];
  return {
    ...value,
    parts,
    timestamp: nonEmptyString(value['timestamp']) ?? new Date().toISOString(),
  };
}

export function normalizeOfficialMessageSendParamsInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const message = normalizeOfficialMessageInput(value['message']);
  const messageRecord = isRecord(value['message']) ? value['message'] : undefined;
  const taskId = nonEmptyString(value['taskId']) ?? nonEmptyString(messageRecord?.['taskId']);
  const contextId =
    nonEmptyString(value['contextId']) ?? nonEmptyString(messageRecord?.['contextId']);
  return {
    ...value,
    message,
    ...(taskId ? { taskId } : {}),
    ...(contextId ? { contextId } : {}),
  };
}

function toOfficialPartJson(part: InternalPart): JsonRecord {
  if (part.type === 'text') {
    return { text: part.text, mediaType: 'text/plain' };
  }
  if (part.type === 'data') {
    return { data: part.data, mediaType: 'application/json' };
  }
  if (part.file.uri) {
    return {
      url: part.file.uri,
      ...(part.file.name ? { filename: part.file.name } : {}),
      mediaType: part.file.mimeType,
    };
  }
  return {
    raw: part.file.bytes ?? '',
    ...(part.file.name ? { filename: part.file.name } : {}),
    mediaType: part.file.mimeType,
  };
}

export function toOfficialMessageJson(message: Message): JsonRecord {
  return {
    messageId: message.messageId,
    role: normalizeMessageRole(message.role),
    parts: message.parts.map(toOfficialPartJson),
    ...(message.contextId ? { contextId: message.contextId } : {}),
    metadata: {},
  };
}

export function toOfficialArtifactJson(artifact: Artifact): JsonRecord {
  return {
    artifactId: artifact.artifactId,
    ...(artifact.name ? { name: artifact.name } : {}),
    ...(artifact.description ? { description: artifact.description } : {}),
    parts: artifact.parts.map(toOfficialPartJson),
    metadata: {},
  };
}

export function toOfficialTaskJson(task: Task): JsonRecord {
  return {
    id: task.id,
    contextId: task.contextId ?? '',
    status: {
      state: officialTaskState(task.status.state),
      timestamp: task.status.timestamp,
    },
    ...(task.artifacts ? { artifacts: task.artifacts.map(toOfficialArtifactJson) } : {}),
    ...(task.history.length > 0 ? { history: task.history.map(toOfficialMessageJson) } : {}),
    metadata: task.metadata ?? {},
  };
}

export function toOfficialSendMessageResponse(result: Task | Message): JsonRecord {
  return 'status' in result
    ? { task: toOfficialTaskJson(result) }
    : { message: toOfficialMessageJson(result) };
}

export function fromOfficialMessageJson(value: unknown): Message {
  if (!isRecord(value)) throw new TypeError('Official message must be an object');
  const normalized = normalizeOfficialMessageInput(value);
  if (!isRecord(normalized) || !Array.isArray(normalized['parts'])) {
    throw new TypeError('Official message is missing parts');
  }
  const contextId = nonEmptyString(normalized['contextId']);
  return {
    role: normalizeMessageRole(String(normalized['role'])),
    parts: normalized['parts'].map((part) => normalizeOfficialPartInput(part) as InternalPart),
    messageId: String(normalized['messageId']),
    timestamp: String(normalized['timestamp']),
    ...(contextId ? { contextId } : {}),
  };
}

export function fromOfficialArtifactJson(value: unknown, index = 0): Artifact {
  if (!isRecord(value) || !Array.isArray(value['parts'])) {
    throw new TypeError('Official artifact must include parts');
  }
  const name = nonEmptyString(value['name']);
  const description = nonEmptyString(value['description']);
  return {
    artifactId: String(value['artifactId']),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    parts: value['parts'].map((part) => normalizeOfficialPartInput(part) as InternalPart),
    index,
  };
}

function fromOfficialStatus(value: unknown): Task['status'] {
  if (!isRecord(value)) throw new TypeError('Official task status must be an object');
  return {
    state: normalizeTaskState(String(value['state'])),
    timestamp: nonEmptyString(value['timestamp']) ?? new Date().toISOString(),
  };
}

export function fromOfficialTaskJson(value: unknown): Task {
  if (!isRecord(value)) throw new TypeError('Official task must be an object');
  const contextId = nonEmptyString(value['contextId']);
  return {
    id: String(value['id']),
    ...(contextId ? { contextId } : {}),
    status: fromOfficialStatus(value['status']),
    history: Array.isArray(value['history']) ? value['history'].map(fromOfficialMessageJson) : [],
    ...(Array.isArray(value['artifacts'])
      ? {
          artifacts: value['artifacts'].map((artifact, index) =>
            fromOfficialArtifactJson(artifact, index),
          ),
        }
      : {}),
    ...(isRecord(value['metadata']) ? { metadata: value['metadata'] } : {}),
  };
}

export function fromOfficialStreamResponse(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ('task' in value) return fromOfficialTaskJson(value['task']);
  if ('message' in value) return fromOfficialMessageJson(value['message']);
  if ('statusUpdate' in value && isRecord(value['statusUpdate'])) {
    const update = value['statusUpdate'];
    const contextId = nonEmptyString(update['contextId']);
    return {
      taskId: String(update['taskId']),
      ...(contextId ? { contextId } : {}),
      status: fromOfficialStatus(update['status']),
      ...(isRecord(update['metadata']) ? { metadata: update['metadata'] } : {}),
    };
  }
  if ('artifactUpdate' in value && isRecord(value['artifactUpdate'])) {
    const update = value['artifactUpdate'];
    const contextId = nonEmptyString(update['contextId']);
    return {
      taskId: String(update['taskId']),
      ...(contextId ? { contextId } : {}),
      artifact: fromOfficialArtifactJson(update['artifact']),
      append: Boolean(update['append']),
      lastChunk: Boolean(update['lastChunk']),
      ...(isRecord(update['metadata']) ? { metadata: update['metadata'] } : {}),
    };
  }
  return value;
}

function looksLikeOfficialTask(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value['status'])) return false;
  const state = value['status']['state'];
  if (typeof state === 'string' && state.startsWith('TASK_STATE_')) return true;
  return (
    Array.isArray(value['artifacts']) &&
    value['artifacts'].some((artifact) => {
      if (!isRecord(artifact) || !Array.isArray(artifact['parts'])) return false;
      return artifact['parts'].some(
        (part) =>
          isRecord(part) &&
          typeof part['type'] !== 'string' &&
          ['text', 'raw', 'url', 'data'].some((key) => key in part),
      );
    })
  );
}

export function normalizeOfficialRpcResult(method: string, value: unknown): unknown {
  if (method === 'message/send' || method === 'message/stream' || method === 'tasks/resubscribe') {
    return fromOfficialStreamResponse(value);
  }
  if (method === 'tasks/get' || method === 'tasks/cancel') {
    return looksLikeOfficialTask(value) ? fromOfficialTaskJson(value) : value;
  }
  return value;
}

function isTaskLike(value: unknown): value is Task {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'status' in value);
}

function isMessageLike(value: unknown): value is Message {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'messageId' in value &&
    'role' in value &&
    'parts' in value,
  );
}

export type A2AJsonRpcDialect = 'mesh' | 'official-v1';

const MESH_TO_OFFICIAL_RPC_METHOD = {
  'message/send': 'SendMessage',
  'message/stream': 'SendStreamingMessage',
  'tasks/get': 'GetTask',
  'tasks/cancel': 'CancelTask',
  'tasks/resubscribe': 'SubscribeToTask',
} as const;

const OFFICIAL_TO_MESH_RPC_METHOD = Object.fromEntries(
  Object.entries(MESH_TO_OFFICIAL_RPC_METHOD).map(([mesh, official]) => [official, mesh]),
) as Record<string, string>;

export function isOfficialV1RpcMethod(method: string): boolean {
  return method in OFFICIAL_TO_MESH_RPC_METHOD;
}

function toOfficialSendMessageRequest(params: unknown): JsonRecord {
  const normalized = normalizeOfficialMessageSendParamsInput(params);
  if (!isRecord(normalized) || !isRecord(normalized['message'])) {
    throw new TypeError('Message request must include a message');
  }
  const configuration = isRecord(normalized['configuration'])
    ? normalized['configuration']
    : undefined;
  return {
    tenant: '',
    message: toOfficialMessageJson(fromOfficialMessageJson(normalized['message'])),
    ...(configuration
      ? {
          configuration: {
            ...(Array.isArray(configuration['acceptedOutputModes'])
              ? { acceptedOutputModes: configuration['acceptedOutputModes'] }
              : {}),
            ...(typeof configuration['returnImmediately'] === 'boolean'
              ? { returnImmediately: configuration['returnImmediately'] }
              : typeof configuration['return_immediately'] === 'boolean'
                ? { returnImmediately: configuration['return_immediately'] }
                : {}),
          },
        }
      : {}),
    metadata: {},
  };
}

export function toOfficialV1RpcRequest(
  method: string,
  params: unknown,
): { method: string; params: unknown } {
  const officialMethod =
    MESH_TO_OFFICIAL_RPC_METHOD[method as keyof typeof MESH_TO_OFFICIAL_RPC_METHOD];
  if (!officialMethod) return { method, params };
  if (method === 'message/send' || method === 'message/stream') {
    return { method: officialMethod, params: toOfficialSendMessageRequest(params) };
  }
  if (method === 'tasks/get' || method === 'tasks/cancel' || method === 'tasks/resubscribe') {
    const record = isRecord(params) ? params : {};
    return {
      method: officialMethod,
      params: {
        tenant: '',
        id: String(record['taskId'] ?? record['id'] ?? ''),
        ...(method === 'tasks/get' && typeof record['historyLength'] === 'number'
          ? { historyLength: record['historyLength'] }
          : {}),
      },
    };
  }
  return { method: officialMethod, params };
}

export function normalizeOfficialV1RpcRequest(
  method: string,
  params: unknown,
): { method: string; params: unknown; officialV1: boolean } {
  const meshMethod = OFFICIAL_TO_MESH_RPC_METHOD[method];
  if (!meshMethod) return { method, params, officialV1: false };
  if (meshMethod === 'message/send' || meshMethod === 'message/stream') {
    return {
      method: meshMethod,
      params: normalizeOfficialMessageSendParamsInput(params),
      officialV1: true,
    };
  }
  if (
    meshMethod === 'tasks/get' ||
    meshMethod === 'tasks/cancel' ||
    meshMethod === 'tasks/resubscribe'
  ) {
    const record = isRecord(params) ? params : {};
    return {
      method: meshMethod,
      params: { ...record, taskId: record['id'] ?? record['taskId'] },
      officialV1: true,
    };
  }
  return { method: meshMethod, params, officialV1: true };
}

export function toOfficialV1RpcResult(originalMethod: string, result: unknown): unknown {
  if (originalMethod === 'SendMessage' && (isTaskLike(result) || isMessageLike(result))) {
    return toOfficialSendMessageResponse(result);
  }
  if ((originalMethod === 'GetTask' || originalMethod === 'CancelTask') && isTaskLike(result)) {
    return toOfficialTaskJson(result);
  }
  return result;
}

export function toOfficialV1StreamResult(task: Task): JsonRecord {
  return { task: toOfficialTaskJson(task) };
}

export function normalizeOfficialSendParams(value: unknown): MessageSendParams {
  return normalizeOfficialMessageSendParamsInput(value) as MessageSendParams;
}
