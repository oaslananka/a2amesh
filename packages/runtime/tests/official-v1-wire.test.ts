import { describe, expect, it } from 'vitest';
import { MessageSendParamsSchema } from '../src/schemas/public.js';
import {
  fromOfficialStreamResponse,
  normalizeOfficialV1RpcRequest,
  toOfficialSendMessageResponse,
  toOfficialTaskJson,
  toOfficialV1RpcRequest,
  toOfficialV1RpcResult,
} from '../src/utils/officialWire.js';

const officialMessage = {
  messageId: 'message-official-1',
  role: 'ROLE_USER',
  parts: [{ text: 'hello official', mediaType: 'text/plain' }],
  metadata: {},
};

describe('official A2A v1 JSON wire compatibility', () => {
  it('normalizes official protobuf JSON message parts and supplies a receive timestamp', () => {
    const parsed = MessageSendParamsSchema.parse({
      message: officialMessage,
      configuration: { acceptedOutputModes: ['text/plain'] },
      metadata: {},
    });

    expect(parsed.message).toMatchObject({
      messageId: 'message-official-1',
      role: 'ROLE_USER',
      parts: [{ type: 'text', text: 'hello official' }],
    });
    expect(Number.isNaN(Date.parse(parsed.message.timestamp))).toBe(false);
  });

  it('serializes an internal task as official protobuf JSON', () => {
    const task = {
      id: 'task-1',
      contextId: 'context-1',
      status: {
        state: 'COMPLETED' as const,
        timestamp: '2026-07-23T10:00:00.000Z',
      },
      artifacts: [
        {
          artifactId: 'artifact-1',
          parts: [{ type: 'text' as const, text: 'official result' }],
          index: 0,
          lastChunk: true,
        },
      ],
      history: [],
      metadata: {},
    };

    expect(toOfficialTaskJson(task)).toMatchObject({
      id: 'task-1',
      contextId: 'context-1',
      status: { state: 'TASK_STATE_COMPLETED' },
      artifacts: [
        {
          artifactId: 'artifact-1',
          parts: [{ text: 'official result', mediaType: 'text/plain' }],
        },
      ],
    });
    expect(toOfficialSendMessageResponse(task)).toEqual({ task: toOfficialTaskJson(task) });
  });

  it('maps official v1 JSON-RPC methods and parameters in both directions', () => {
    const outbound = toOfficialV1RpcRequest('message/stream', {
      message: {
        messageId: 'message-outbound',
        role: 'ROLE_USER',
        parts: [{ type: 'text', text: 'hello outbound' }],
        timestamp: '2026-07-23T10:00:00.000Z',
      },
    });
    expect(outbound).toMatchObject({
      method: 'SendStreamingMessage',
      params: {
        message: {
          messageId: 'message-outbound',
          parts: [{ text: 'hello outbound', mediaType: 'text/plain' }],
        },
      },
    });

    expect(normalizeOfficialV1RpcRequest('GetTask', { id: 'task-1' })).toEqual({
      method: 'tasks/get',
      params: { id: 'task-1', taskId: 'task-1' },
      officialV1: true,
    });
    expect(toOfficialV1RpcRequest('tasks/get', { taskId: 'task-1' })).toEqual({
      method: 'GetTask',
      params: { tenant: '', id: 'task-1' },
    });
    expect(toOfficialV1RpcRequest('tasks/cancel', { taskId: 'task-1' })).toEqual({
      method: 'CancelTask',
      params: { tenant: '', id: 'task-1' },
    });
    expect(
      toOfficialV1RpcResult('GetTask', {
        id: 'task-1',
        status: { state: 'COMPLETED', timestamp: '2026-07-23T10:00:00.000Z' },
        history: [],
      }),
    ).toMatchObject({
      id: 'task-1',
      status: { state: 'TASK_STATE_COMPLETED' },
    });
  });

  it('unwraps and normalizes official JSON-RPC stream responses', () => {
    expect(
      fromOfficialStreamResponse({
        statusUpdate: {
          taskId: 'task-1',
          contextId: 'context-1',
          status: {
            state: 'TASK_STATE_WORKING',
            timestamp: '2026-07-23T10:00:00.000Z',
          },
        },
      }),
    ).toMatchObject({
      taskId: 'task-1',
      contextId: 'context-1',
      status: { state: 'WORKING' },
    });

    expect(
      fromOfficialStreamResponse({
        artifactUpdate: {
          taskId: 'task-1',
          contextId: 'context-1',
          artifact: {
            artifactId: 'artifact-1',
            parts: [{ text: 'stream result', mediaType: 'text/plain' }],
          },
          lastChunk: true,
        },
      }),
    ).toMatchObject({
      taskId: 'task-1',
      artifact: {
        artifactId: 'artifact-1',
        parts: [{ type: 'text', text: 'stream result' }],
      },
      lastChunk: true,
    });
  });
});
