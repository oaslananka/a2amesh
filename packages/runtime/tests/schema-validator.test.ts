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

  it('sanitizes validation paths and messages without marking bounded details as truncated', () => {
    const longSegment = 'segment-'.repeat(12);
    const longMessage = 'message-'.repeat(30);
    const schema = z.unknown().superRefine((_value, context) => {
      context.addIssue({
        code: 'custom',
        path: [longSegment, 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
        message: longMessage,
      });
    });

    const error = captureJsonRpcError(() => validateRequest(schema, 'invalid'));
    const metadata = error.data?.[0]?.metadata;
    const details = JSON.parse(metadata?.['details'] ?? '[]') as Array<{
      code: string;
      path: string[];
      message: string;
    }>;

    expect(metadata).toEqual({
      issueCount: '1',
      details: expect.any(String),
    });
    expect(details).toEqual([
      {
        code: 'custom',
        path: [longSegment.slice(0, 64), 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
        message: longMessage.slice(0, 160),
      },
    ]);
  });

  it('retains only the first eight validation issues and marks the summary as truncated', () => {
    const schema = z.unknown().superRefine((_value, context) => {
      for (let index = 0; index < 9; index += 1) {
        context.addIssue({ code: 'custom', path: [index], message: `issue-${index}` });
      }
    });

    const error = captureJsonRpcError(() => validateRequest(schema, 'invalid'));
    const metadata = error.data?.[0]?.metadata;
    const details = JSON.parse(metadata?.['details'] ?? '[]') as Array<{ message: string }>;

    expect(metadata).toEqual({
      issueCount: '9',
      details: expect.any(String),
      truncated: 'true',
    });
    expect(details).toHaveLength(8);
    expect(details.map((issue) => issue.message)).toEqual([
      'issue-0',
      'issue-1',
      'issue-2',
      'issue-3',
      'issue-4',
      'issue-5',
      'issue-6',
      'issue-7',
    ]);
  });

  it('caps serialized validation details at 1024 characters independently of issue count', () => {
    const schema = z.unknown().superRefine((_value, context) => {
      for (let index = 0; index < 8; index += 1) {
        context.addIssue({
          code: 'custom',
          path: Array.from(
            { length: 8 },
            (_, segment) => `path-${index}-${segment}-${'x'.repeat(64)}`,
          ),
          message: `message-${index}-${'y'.repeat(200)}`,
        });
      }
    });

    const error = captureJsonRpcError(() => validateRequest(schema, 'invalid'));
    const metadata = error.data?.[0]?.metadata;

    expect(metadata).toEqual({
      issueCount: '8',
      details: expect.any(String),
      truncated: 'true',
    });
    expect(metadata?.['details']).toHaveLength(1024);
  });

  it('bounds validation issue details without echoing invalid input values', () => {
    const secret = 'validator-secret-value';
    const invalidParts = Array.from({ length: 40 }, (_, index) => ({
      type: 'text',
      text: { secret, index },
    }));
    const error = captureJsonRpcError(() =>
      validateMessageSendParams({
        message: {
          role: 'user',
          parts: invalidParts,
          messageId: 'bounded-validation',
          timestamp: '2026-07-27T00:00:00.000Z',
        },
      }),
    );

    const metadata = error.data?.[0]?.metadata;
    expect(metadata).toEqual(
      expect.objectContaining({
        issueCount: '40',
        truncated: 'true',
        details: expect.stringContaining('invalid_type'),
      }),
    );
    expect(metadata?.['details']?.length).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(error.data)).not.toContain(secret);
    expect(JSON.stringify(error.data).length).toBeLessThan(2048);
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
        metadata: expect.objectContaining({
          details: expect.stringContaining('too_big'),
          issueCount: '2',
        }),
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
