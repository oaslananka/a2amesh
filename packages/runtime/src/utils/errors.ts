import { ErrorCodes, JsonRpcError, type GoogleRpcErrorInfo } from '../types/jsonrpc.js';

const ERROR_REASON_BY_CODE: Record<number, string> = {
  [ErrorCodes.ParseError]: 'PARSE_ERROR',
  [ErrorCodes.InvalidRequest]: 'INVALID_REQUEST',
  [ErrorCodes.MethodNotFound]: 'METHOD_NOT_FOUND',
  [ErrorCodes.InvalidParams]: 'INVALID_PARAMETERS',
  [ErrorCodes.InternalError]: 'INTERNAL_ERROR',
  [ErrorCodes.TaskNotFound]: 'TASK_NOT_FOUND',
  [ErrorCodes.PushNotificationNotSupported]: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
  [ErrorCodes.UnsupportedOperation]: 'UNSUPPORTED_OPERATION',
  [ErrorCodes.RateLimitExceeded]: 'RATE_LIMIT_EXCEEDED',
  [ErrorCodes.Unauthorized]: 'UNAUTHORIZED',
  [ErrorCodes.ExtensionRequired]: 'EXTENSION_REQUIRED',
  [ErrorCodes.InvalidTaskTransition]: 'INVALID_TASK_TRANSITION',
  [ErrorCodes.IdempotencyConflict]: 'IDEMPOTENCY_CONFLICT',
  [ErrorCodes.IdempotencyInProgress]: 'IDEMPOTENCY_IN_PROGRESS',
};

export function makeErrorInfo(
  reason: string,
  metadata?: Record<string, string>,
): GoogleRpcErrorInfo[] {
  return [
    {
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason,
      domain: 'a2a-protocol.org',
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
  ];
}

export function makeA2AError(
  code: number,
  message: string,
  reason: string,
  metadata?: Record<string, string>,
): JsonRpcError {
  return new JsonRpcError(code, message, makeErrorInfo(reason, metadata));
}

export function reasonForErrorCode(code: number): string {
  return ERROR_REASON_BY_CODE[code] ?? 'A2A_ERROR';
}

export function metadataFromUnknown(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nextValue]) => [key, String(nextValue)]),
    );
  }
  return { details: String(value) };
}
