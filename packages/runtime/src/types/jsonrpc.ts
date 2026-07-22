/**
 * @file jsonrpc.ts
 * JSON-RPC 2.0 request/response helpers for A2A endpoints.
 */

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown> | unknown[];
  id?: JsonRpcId;
}

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: '2.0';
  result: T;
  id: JsonRpcId;
}

export interface GoogleRpcErrorInfo {
  '@type': 'type.googleapis.com/google.rpc.ErrorInfo';
  reason: string;
  domain: 'a2a-protocol.org';
  metadata?: Record<string, string>;
}

export interface JsonRpcFailureResponse {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: GoogleRpcErrorInfo[];
  };
  id: JsonRpcId;
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccessResponse<T> | JsonRpcFailureResponse;

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  TaskNotFound: -32004,
  VersionNotSupported: -32009,
  PushNotificationNotSupported: -32010,
  UnsupportedOperation: -32011,
  RateLimitExceeded: -32029,
  Unauthorized: -32040,
  ExtensionRequired: -32041,
  InvalidTaskTransition: -32042,
  IdempotencyConflict: -32043,
  IdempotencyInProgress: -32044,
} as const;

export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: GoogleRpcErrorInfo[];

  constructor(code: number, message: string, data?: GoogleRpcErrorInfo[] | unknown) {
    super(message);
    this.code = code;
    const normalizedData = normalizeErrorData(code, data);
    if (normalizedData !== undefined) {
      this.data = normalizedData;
    }
  }
}

function normalizeErrorData(
  code: number,
  data: GoogleRpcErrorInfo[] | unknown,
): GoogleRpcErrorInfo[] | undefined {
  if (data === undefined) {
    return undefined;
  }
  if (Array.isArray(data) && data.every(isGoogleRpcErrorInfo)) {
    return data;
  }

  const metadata = metadataFromUnknown(data);
  return [
    {
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: reasonForCode(code),
      domain: 'a2a-protocol.org',
      ...(metadata ? { metadata } : {}),
    },
  ];
}

function isGoogleRpcErrorInfo(value: unknown): value is GoogleRpcErrorInfo {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { '@type'?: unknown })['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo'
  );
}

function metadataFromUnknown(data: unknown): Record<string, string> | undefined {
  if (data === undefined) {
    return undefined;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data).map(([key, value]) => [key, stringifyMetadata(value)]);
    return Object.fromEntries(entries);
  }
  return { details: stringifyMetadata(data) };
}

function stringifyMetadata(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function reasonForCode(code: number): string {
  switch (code) {
    case ErrorCodes.ParseError:
      return 'PARSE_ERROR';
    case ErrorCodes.InvalidRequest:
      return 'INVALID_REQUEST';
    case ErrorCodes.MethodNotFound:
      return 'METHOD_NOT_FOUND';
    case ErrorCodes.InvalidParams:
      return 'INVALID_PARAMETERS';
    case ErrorCodes.InternalError:
      return 'INTERNAL_ERROR';
    case ErrorCodes.TaskNotFound:
      return 'TASK_NOT_FOUND';
    case ErrorCodes.VersionNotSupported:
      return 'VERSION_NOT_SUPPORTED';
    case ErrorCodes.PushNotificationNotSupported:
      return 'PUSH_NOTIFICATION_NOT_SUPPORTED';
    case ErrorCodes.UnsupportedOperation:
      return 'UNSUPPORTED_OPERATION';
    case ErrorCodes.RateLimitExceeded:
      return 'RATE_LIMIT_EXCEEDED';
    case ErrorCodes.Unauthorized:
      return 'UNAUTHORIZED';
    case ErrorCodes.ExtensionRequired:
      return 'EXTENSION_REQUIRED';
    case ErrorCodes.InvalidTaskTransition:
      return 'INVALID_TASK_TRANSITION';
    case ErrorCodes.IdempotencyConflict:
      return 'IDEMPOTENCY_CONFLICT';
    case ErrorCodes.IdempotencyInProgress:
      return 'IDEMPOTENCY_IN_PROGRESS';
    default:
      return 'A2A_ERROR';
  }
}
