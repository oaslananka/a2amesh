import { describe, expect, it } from 'vitest';
import { ErrorCodes, JsonRpcError } from '../src/types/jsonrpc.js';
import {
  assertJsonRpcInputLimits,
  DEFAULT_JSON_RPC_INPUT_LIMITS,
  resolveJsonRpcInputLimits,
} from '../src/utils/json-rpc-input-limits.js';

describe('JSON-RPC input limit mutation contracts', () => {
  it('resolves defaults and partial overrides without mutating the defaults', () => {
    expect(resolveJsonRpcInputLimits(undefined)).toEqual({
      maxDepth: 32,
      maxCollectionEntries: 1000,
    });
    expect(resolveJsonRpcInputLimits({ maxDepth: 7 })).toEqual({
      maxDepth: 7,
      maxCollectionEntries: 1000,
    });
    expect(resolveJsonRpcInputLimits({ maxCollectionEntries: 25 })).toEqual({
      maxDepth: 32,
      maxCollectionEntries: 25,
    });
    expect(DEFAULT_JSON_RPC_INPUT_LIMITS).toEqual({
      maxDepth: 32,
      maxCollectionEntries: 1000,
    });
  });

  it('handles repeated and cyclic object references without unbounded traversal', () => {
    const shared = { value: 'shared' };
    const cyclic: { shared: typeof shared; self?: unknown; list: unknown[] } = {
      shared,
      list: [shared, null, 'primitive'],
    };
    cyclic.self = cyclic;

    expect(() =>
      assertJsonRpcInputLimits(cyclic, { maxDepth: 4, maxCollectionEntries: 4 }),
    ).not.toThrow();
  });

  it('normalizes direct InvalidRequest metadata with the canonical reason', () => {
    expect(
      new JsonRpcError(ErrorCodes.InvalidRequest, 'invalid request', { source: 'input-limit' })
        .data,
    ).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'INVALID_REQUEST',
        domain: 'a2a-protocol.org',
        metadata: { source: 'input-limit' },
      },
    ]);
  });

  it('rejects arrays and objects beyond the collection boundary', () => {
    expect(() =>
      assertJsonRpcInputLimits(
        { params: [1, 2, 3, 4, 5] },
        { maxDepth: 4, maxCollectionEntries: 4 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCodes.InvalidRequest,
        message: 'JSON-RPC request exceeds input limits',
        data: [
          expect.objectContaining({
            reason: 'INVALID_REQUEST',
            metadata: { limit: 'collection', maximum: '4', actual: '5' },
          }),
        ],
      }),
    );
  });

  it('rejects object graphs beyond the depth boundary', () => {
    expect(() =>
      assertJsonRpcInputLimits(
        { first: { second: { third: { leaf: true } } } },
        { maxDepth: 2, maxCollectionEntries: 4 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCodes.InvalidRequest,
        data: [
          expect.objectContaining({
            metadata: { limit: 'depth', maximum: '2', actual: '3' },
          }),
        ],
      }),
    );
  });

  it('accepts values exactly on both configured boundaries', () => {
    expect(() =>
      assertJsonRpcInputLimits(
        { first: { second: true }, a: 1, b: 2, c: 3 },
        { maxDepth: 2, maxCollectionEntries: 4 },
      ),
    ).not.toThrow();
  });
});
