import type { Request, Response } from 'express';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import type { RequestContext } from '../../types/auth.js';
import type { JsonRpcRequest } from '../../types/jsonrpc.js';
import type { IdempotencyStore } from '../IdempotencyStore.js';
import {
  completeIdempotency,
  decorateIdempotentResult,
  resolveIdempotency,
  startIdempotencyLease,
  type IdempotencyResolution,
} from './idempotency.js';
import { isStreamingRpcMethod } from './streamRoutes.js';

export interface JsonRpcIdempotencyResolutionDependencies {
  store: IdempotencyStore;
  leaseMs: number;
  runtimeMetrics: RuntimeMetrics;
}

export interface JsonRpcIdempotencyExecutionDependencies {
  store: IdempotencyStore;
  ttlMs: number;
  runtimeMetrics: RuntimeMetrics;
}

export async function resolveJsonRpcExecutionIdempotency(
  req: Request,
  rpcReq: JsonRpcRequest,
  requestContext: RequestContext,
  res: Response,
  deps: JsonRpcIdempotencyResolutionDependencies,
): Promise<IdempotencyResolution | null | undefined> {
  return resolveIdempotency(req, rpcReq, requestContext, res, deps.store, {
    deferReplay: isStreamingRpcMethod(rpcReq.method),
    leaseMs: deps.leaseMs,
    runtimeMetrics: deps.runtimeMetrics,
  });
}

export async function executeJsonRpcIdempotentRequest(
  rpcReq: JsonRpcRequest,
  idempotency: IdempotencyResolution | null | undefined,
  execute: () => Promise<unknown>,
  deps: JsonRpcIdempotencyExecutionDependencies,
): Promise<unknown> {
  const lease = startIdempotencyLease(idempotency, deps.store, deps.runtimeMetrics, rpcReq.method);
  try {
    const result = await execute();
    const responseResult = idempotency
      ? decorateIdempotentResult(result, idempotency, false)
      : result;
    if (idempotency) {
      await completeIdempotency(
        deps.store,
        idempotency,
        { kind: 'success', value: structuredClone(responseResult) },
        deps.ttlMs,
      );
    }
    return responseResult;
  } finally {
    lease?.stop();
  }
}
