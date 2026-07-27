import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ErrorCodes, JsonRpcError } from '../src/types/jsonrpc.js';
import {
  validateJsonRpcRequest,
  validateMessageSendParams,
  validateRequest,
  validateTaskListParams,
} from '../src/utils/schema-validator.js';

function createMessageSendParams(timestamp?: string): Record<string, unknown> {
  return {
    message: {
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      messageId: 'message-1',
      ...(timestamp === undefined ? {} : { timestamp }),
    },
  };
}

function captureJsonRpcError(run: () => unknown): JsonRpcError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(JsonRpcError);
    return error as JsonRpcError;
  }
  throw new Error('Expected JsonRpcError');
}

describe('schema validator contracts', () => {
  it('returns parsed data from generic request schemas', () => {
    const schema = z.object({ count: z.number().int().positive() });
    expect(validateRequest(schema, { count: 2 })).toEqual({ count: 2 });
  });

  it('reports generic validation failures as INVALID_PARAMETERS ErrorInfo', () => {
    const schema = z.object({ count: z.number().int().positive() });
    const error = captureJsonRpcError(() => validateRequest(schema, { count: 0 }));

    expect(error).toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'Invalid parameters',
      data: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'INVALID_PARAMETERS',
          domain: 'a2a-protocol.org',
          metadata: { details: expect.stringContaining('too_small') },
        },
      ],
    });
  });

  it('accepts and returns valid JSON-RPC requests', () => {
    expect(
      validateJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'message/send',
        params: { taskId: 'task-1' },
        id: 7,
      }),
    ).toEqual({
      jsonrpc: '2.0',
      method: 'message/send',
      params: { taskId: 'task-1' },
      id: 7,
    });
  });

  it('reports malformed JSON-RPC envelopes as INVALID_REQUEST ErrorInfo', () => {
    const error = captureJsonRpcError(() => validateJsonRpcRequest({ jsonrpc: '1.0', method: 42 }));

    expect(error).toMatchObject({
      code: ErrorCodes.InvalidRequest,
      message: 'Invalid JSON-RPC request',
      data: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'INVALID_REQUEST',
          domain: 'a2a-protocol.org',
          metadata: { details: expect.stringContaining('invalid_value') },
        },
      ],
    });
  });

  it('validates task list pagination boundaries', () => {
    expect(validateTaskListParams({ contextId: 'context-1', limit: 500, offset: 0 })).toEqual({
      contextId: 'context-1',
      limit: 500,
      offset: 0,
    });

    const error = captureJsonRpcError(() => validateTaskListParams({ limit: 501, offset: -1 }));
    expect(error.code).toBe(ErrorCodes.InvalidParams);
    expect(error.message).toBe('Invalid parameters');
    expect(error.data?.[0]).toEqual(
      expect.objectContaining({
        reason: 'INVALID_PARAMETERS',
        domain: 'a2a-protocol.org',
        metadata: { details: expect.stringContaining('too_big') },
      }),
    );
  });
});

describe('schema validator message timestamps', () => {
  it('accepts UTC ISO datetimes', () => {
    const params = validateMessageSendParams(createMessageSendParams('2026-04-06T10:00:00.000Z'));
    expect(params.message.timestamp).toBe('2026-04-06T10:00:00.000Z');
  });

  it('accepts ISO datetimes with timezone offsets', () => {
    const params = validateMessageSendParams(createMessageSendParams('2026-04-06T13:00:00+03:00'));
    expect(params.message.timestamp).toBe('2026-04-06T13:00:00+03:00');
  });

  it.each(['not-a-date', '2026-13-01T00:00:00Z'])(
    'rejects invalid message timestamp %s',
    (timestamp) => {
      const error = captureJsonRpcError(() =>
        validateMessageSendParams(createMessageSendParams(timestamp)),
      );
      expect(error.code).toBe(ErrorCodes.InvalidParams);
      expect(error.message).toBe('Invalid parameters');
    },
  );

  it('rejects missing message timestamps', () => {
    const error = captureJsonRpcError(() => validateMessageSendParams(createMessageSendParams()));
    expect(error.code).toBe(ErrorCodes.InvalidParams);
    expect(error.message).toBe('Invalid parameters');
  });
});
