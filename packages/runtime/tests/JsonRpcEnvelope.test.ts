import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { prepareJsonRpcRequest } from '../src/server/http/jsonRpcEnvelope.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';

function createRequest(body: unknown, version?: string): Request {
  return {
    body,
    query: {},
    get(name: string) {
      return name.toLowerCase() === 'a2a-version' ? version : undefined;
    },
  } as unknown as Request;
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

describe('JSON-RPC envelope preparation', () => {
  it('preserves mesh requests and normalizes official v1 methods and parameters', () => {
    const mesh = prepareJsonRpcRequest(
      createRequest({ jsonrpc: '2.0', id: 0, method: 'tasks/get', params: { taskId: 'task-1' } }),
    );
    expect(mesh).toEqual({
      receivedRpcReq: {
        jsonrpc: '2.0',
        id: 0,
        method: 'tasks/get',
        params: { taskId: 'task-1' },
      },
      rpcReq: {
        jsonrpc: '2.0',
        id: 0,
        method: 'tasks/get',
        params: { taskId: 'task-1' },
      },
      responseDialect: 'mesh',
    });

    const official = prepareJsonRpcRequest(
      createRequest(
        {
          jsonrpc: '2.0',
          id: 'official',
          method: 'GetTask',
          params: { tenant: 'tenant-a', id: 'task-2', historyLength: 3 },
        },
        '1.0',
      ),
    );
    expect(official.receivedRpcReq.method).toBe('GetTask');
    expect(official.rpcReq).toEqual({
      jsonrpc: '2.0',
      id: 'official',
      method: 'tasks/get',
      params: {
        tenant: 'tenant-a',
        id: 'task-2',
        historyLength: 3,
        taskId: 'task-2',
      },
    });
    expect(official.responseDialect).toBe('official-v1');
  });

  it('rejects batches before collection limits are evaluated', () => {
    expect(
      captureError(() =>
        prepareJsonRpcRequest(createRequest([{ jsonrpc: '2.0' }]), {
          maxDepth: 0,
          maxCollectionEntries: 0,
        }),
      ),
    ).toMatchObject({
      code: ErrorCodes.InvalidRequest,
      message: 'Batch requests are not supported',
    });
  });

  it('preserves protocol, input-limit, and schema validation errors', () => {
    expect(
      captureError(() =>
        prepareJsonRpcRequest(
          createRequest({ jsonrpc: '2.0', id: 'version', method: 'tasks/get' }, '9.9'),
        ),
      ),
    ).toMatchObject({ code: ErrorCodes.VersionNotSupported });

    expect(
      captureError(() =>
        prepareJsonRpcRequest(
          createRequest({
            jsonrpc: '2.0',
            id: 'limit',
            method: 'tasks/get',
            params: { values: [1, 2] },
          }),
          { maxDepth: 8, maxCollectionEntries: 1 },
        ),
      ),
    ).toMatchObject({
      code: ErrorCodes.InvalidRequest,
      message: 'JSON-RPC request exceeds input limits',
    });

    expect(
      captureError(() =>
        prepareJsonRpcRequest(createRequest({ jsonrpc: '2.0', id: 'invalid', method: 42 })),
      ),
    ).toMatchObject({
      code: ErrorCodes.InvalidRequest,
      message: 'Invalid JSON-RPC request',
    });
  });
});
