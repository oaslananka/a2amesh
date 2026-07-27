import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocsUrl } from '../src/config/docs.js';
import {
  isAgentMessage,
  isTerminalTaskState,
  normalizeMessage,
  taskStateMetadataKey,
} from '../src/utils/compat.js';
import {
  makeA2AError,
  makeErrorInfo,
  metadataFromUnknown,
  reasonForErrorCode,
} from '../src/utils/errors.js';
import { ErrorCodes, JsonRpcError, type GoogleRpcErrorInfo } from '../src/types/jsonrpc.js';

describe('JSON-RPC error helpers', () => {
  it('maps A2A error codes to ErrorInfo reasons', () => {
    expect(reasonForErrorCode(ErrorCodes.ParseError)).toBe('PARSE_ERROR');
    expect(reasonForErrorCode(ErrorCodes.InvalidRequest)).toBe('INVALID_REQUEST');
    expect(reasonForErrorCode(ErrorCodes.MethodNotFound)).toBe('METHOD_NOT_FOUND');
    expect(reasonForErrorCode(ErrorCodes.InvalidParams)).toBe('INVALID_PARAMETERS');
    expect(reasonForErrorCode(ErrorCodes.InternalError)).toBe('INTERNAL_ERROR');
    expect(reasonForErrorCode(ErrorCodes.TaskNotFound)).toBe('TASK_NOT_FOUND');
    expect(reasonForErrorCode(ErrorCodes.VersionNotSupported)).toBe('VERSION_NOT_SUPPORTED');
    expect(reasonForErrorCode(ErrorCodes.PushNotificationNotSupported)).toBe(
      'PUSH_NOTIFICATION_NOT_SUPPORTED',
    );
    expect(reasonForErrorCode(ErrorCodes.UnsupportedOperation)).toBe('UNSUPPORTED_OPERATION');
    expect(reasonForErrorCode(ErrorCodes.RateLimitExceeded)).toBe('RATE_LIMIT_EXCEEDED');
    expect(reasonForErrorCode(ErrorCodes.Unauthorized)).toBe('UNAUTHORIZED');
    expect(reasonForErrorCode(ErrorCodes.ExtensionRequired)).toBe('EXTENSION_REQUIRED');
    expect(reasonForErrorCode(ErrorCodes.InvalidTaskTransition)).toBe('INVALID_TASK_TRANSITION');
    expect(reasonForErrorCode(ErrorCodes.IdempotencyConflict)).toBe('IDEMPOTENCY_CONFLICT');
    expect(reasonForErrorCode(ErrorCodes.IdempotencyInProgress)).toBe('IDEMPOTENCY_IN_PROGRESS');
    expect(reasonForErrorCode(-32099)).toBe('A2A_ERROR');
  });

  it('normalizes metadata and constructs protocol ErrorInfo payloads', () => {
    expect(makeErrorInfo('TEST_REASON')).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'TEST_REASON',
        domain: 'a2a-protocol.org',
      },
    ]);
    expect(makeErrorInfo('TEST_REASON', { taskId: 'task-1' })).toEqual([
      expect.objectContaining({
        metadata: { taskId: 'task-1' },
      }),
    ]);

    expect(metadataFromUnknown(undefined)).toBeUndefined();
    expect(metadataFromUnknown({ retryAfter: 30, fatal: false })).toEqual({
      retryAfter: '30',
      fatal: 'false',
    });
    expect(metadataFromUnknown(['bad'])).toEqual({ details: 'bad' });
    expect(metadataFromUnknown(null)).toEqual({ details: 'null' });
    expect(metadataFromUnknown(false)).toEqual({ details: 'false' });
    expect(metadataFromUnknown('text')).toEqual({ details: 'text' });
    expect(makeErrorInfo('EMPTY_METADATA', {})).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'EMPTY_METADATA',
        domain: 'a2a-protocol.org',
      },
    ]);

    const error = makeA2AError(ErrorCodes.TaskNotFound, 'missing', 'TASK_NOT_FOUND', {
      taskId: 'task-1',
    });
    expect(error).toMatchObject({
      code: ErrorCodes.TaskNotFound,
      message: 'missing',
      data: [
        expect.objectContaining({
          reason: 'TASK_NOT_FOUND',
          metadata: { taskId: 'task-1' },
        }),
      ],
    });
  });

  it('maps every JsonRpcError code to exact generated ErrorInfo identity', () => {
    const mappings = [
      [ErrorCodes.ParseError, 'PARSE_ERROR'],
      [ErrorCodes.InvalidRequest, 'INVALID_REQUEST'],
      [ErrorCodes.MethodNotFound, 'METHOD_NOT_FOUND'],
      [ErrorCodes.InvalidParams, 'INVALID_PARAMETERS'],
      [ErrorCodes.InternalError, 'INTERNAL_ERROR'],
      [ErrorCodes.TaskNotFound, 'TASK_NOT_FOUND'],
      [ErrorCodes.VersionNotSupported, 'VERSION_NOT_SUPPORTED'],
      [ErrorCodes.PushNotificationNotSupported, 'PUSH_NOTIFICATION_NOT_SUPPORTED'],
      [ErrorCodes.UnsupportedOperation, 'UNSUPPORTED_OPERATION'],
      [ErrorCodes.RateLimitExceeded, 'RATE_LIMIT_EXCEEDED'],
      [ErrorCodes.Unauthorized, 'UNAUTHORIZED'],
      [ErrorCodes.ExtensionRequired, 'EXTENSION_REQUIRED'],
      [ErrorCodes.InvalidTaskTransition, 'INVALID_TASK_TRANSITION'],
      [ErrorCodes.IdempotencyConflict, 'IDEMPOTENCY_CONFLICT'],
      [ErrorCodes.IdempotencyInProgress, 'IDEMPOTENCY_IN_PROGRESS'],
      [-32099, 'A2A_ERROR'],
    ] as const;

    for (const [code, reason] of mappings) {
      expect(new JsonRpcError(code, 'mapped', 'details').data).toEqual([
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason,
          domain: 'a2a-protocol.org',
          metadata: { details: 'details' },
        },
      ]);
    }
  });

  it('keeps valid ErrorInfo arrays and wraps unknown data in stable metadata', () => {
    const validInfo: GoogleRpcErrorInfo[] = [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'UPSTREAM',
        domain: 'a2a-protocol.org',
      },
    ];
    expect(new JsonRpcError(ErrorCodes.InternalError, 'upstream', validInfo).data).toBe(validInfo);
    const noDataError = new JsonRpcError(ErrorCodes.InvalidParams, 'bad');
    expect(noDataError.data).toBeUndefined();
    expect(new JsonRpcError(ErrorCodes.RateLimitExceeded, 'slow down', 'later').data).toEqual([
      expect.objectContaining({
        reason: 'RATE_LIMIT_EXCEEDED',
        metadata: { details: 'later' },
      }),
    ]);
    expect(new JsonRpcError(ErrorCodes.InternalError, 'null-info', [null]).data).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'INTERNAL_ERROR',
        domain: 'a2a-protocol.org',
        metadata: { details: '[null]' },
      },
    ]);
    const mixedInfo = [validInfo[0]!, { bad: true }];
    expect(new JsonRpcError(ErrorCodes.InternalError, 'mixed', mixedInfo).data).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'INTERNAL_ERROR',
        domain: 'a2a-protocol.org',
        metadata: { details: JSON.stringify(mixedInfo) },
      },
    ]);
    expect(new JsonRpcError(ErrorCodes.InternalError, 'null', null).data).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'INTERNAL_ERROR',
        domain: 'a2a-protocol.org',
        metadata: { details: 'null' },
      },
    ]);
    expect(new JsonRpcError(-32099, 'custom', [{ bad: true }]).data).toEqual([
      expect.objectContaining({
        reason: 'A2A_ERROR',
        metadata: { details: '[{"bad":true}]' },
      }),
    ]);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(new JsonRpcError(ErrorCodes.InternalError, 'circular', circular).data).toEqual([
      expect.objectContaining({
        metadata: { self: '[object Object]' },
      }),
    ]);
  });
});

describe('compat helper coverage', () => {
  it('normalizes messages and terminal state metadata keys', () => {
    expect(
      normalizeMessage({
        role: 'agent',
        parts: [{ type: 'text', text: 'done' }],
        messageId: 'message-1',
        timestamp: new Date().toISOString(),
      }),
    ).toEqual(
      expect.objectContaining({
        role: 'ROLE_AGENT',
      }),
    );
    expect(isAgentMessage({ role: 'ROLE_AGENT' })).toBe(true);
    expect(isAgentMessage({ role: 'ROLE_USER' })).toBe(false);
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('WORKING')).toBe(false);
    expect(taskStateMetadataKey('INPUT_REQUIRED')).toBe('inputRequiredAt');
    expect(taskStateMetadataKey('WAITING_ON_EXTERNAL')).toBe('waitingOnExternalAt');
    expect(taskStateMetadataKey('COMPLETED')).toBe('completedAt');
  });
});

describe('documentation URL configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('normalizes the configured public docs URL', async () => {
    vi.stubEnv('A2AMESH_DOCS_PUBLIC_URL', 'https://docs.example.com/base');
    vi.resetModules();
    const docs = await import('../src/config/docs.js');

    expect(docs.getDocsUrl()).toBe('https://docs.example.com/base/');
    expect(docs.getDocsUrl('/install')).toBe('https://docs.example.com/base/install');
  });

  it('uses the default docs URL when the environment value is blank', async () => {
    vi.stubEnv('A2AMESH_DOCS_PUBLIC_URL', '   ');
    vi.resetModules();
    const docs = await import('../src/config/docs.js');

    expect(docs.getDocsUrl()).toBe('https://docs.a2amesh.local/');
    expect(docs.getDocsUrl('quickstart')).toBe('https://docs.a2amesh.local/quickstart');
  });

  it('keeps the statically imported default URL stable for current module users', () => {
    expect(getDocsUrl('security/auth')).toBe('https://docs.a2amesh.local/security/auth');
  });
});
