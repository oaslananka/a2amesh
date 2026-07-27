import { ErrorCodes, JsonRpcError } from '../types/jsonrpc.js';

export interface JsonRpcInputLimits {
  maxDepth: number;
  maxCollectionEntries: number;
}

export const DEFAULT_JSON_RPC_INPUT_LIMITS: Readonly<JsonRpcInputLimits> = Object.freeze({
  maxDepth: 32,
  maxCollectionEntries: 1000,
});

export function resolveJsonRpcInputLimits(
  overrides: Partial<JsonRpcInputLimits> | undefined,
): JsonRpcInputLimits {
  return {
    maxDepth: overrides?.maxDepth ?? DEFAULT_JSON_RPC_INPUT_LIMITS.maxDepth,
    maxCollectionEntries:
      overrides?.maxCollectionEntries ?? DEFAULT_JSON_RPC_INPUT_LIMITS.maxCollectionEntries,
  };
}

export function assertJsonRpcInputLimits(value: unknown, limits: JsonRpcInputLimits): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const visited = new WeakSet<object>();

  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (current.value === null || typeof current.value !== 'object') continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);

    if (current.depth > limits.maxDepth) {
      throwInputLimitError('depth', limits.maxDepth, current.depth);
    }

    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (children.length > limits.maxCollectionEntries) {
      throwInputLimitError('collection', limits.maxCollectionEntries, children.length);
    }

    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function throwInputLimitError(
  limit: 'depth' | 'collection',
  maximum: number,
  actual: number,
): never {
  throw new JsonRpcError(ErrorCodes.InvalidRequest, 'JSON-RPC request exceeds input limits', {
    limit,
    maximum: String(maximum),
    actual: String(actual),
  });
}
