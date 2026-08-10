import type { Request, Response } from 'express';
import {
  ErrorCodes,
  JsonRpcError,
  type JsonRpcFailureResponse,
  type JsonRpcId,
  type JsonRpcSuccessResponse,
} from '../../types/jsonrpc.js';
import { logger } from '../../utils/logger.js';
import { toOfficialV1JsonRpcError, type A2AJsonRpcDialect } from '../../utils/officialWire.js';
import type { IdempotencyStore } from '../IdempotencyStore.js';
import {
  completeIdempotency,
  extractJsonRpcId,
  releaseIdempotency,
  type IdempotencyResolution,
} from './idempotency.js';

export interface JsonRpcErrorResponseDependencies {
  store: IdempotencyStore;
  ttlMs: number;
  responseDialect?: A2AJsonRpcDialect;
  originalMethod?: string;
}

export function createJsonRpcSuccessResponse<T>(
  result: T,
  id: JsonRpcId,
): JsonRpcSuccessResponse<T> {
  return {
    jsonrpc: '2.0',
    result,
    id,
  };
}

export function createJsonRpcErrorResponse(
  error: Pick<JsonRpcError, 'code' | 'message' | 'data'>,
  id: JsonRpcId,
): JsonRpcFailureResponse {
  return {
    jsonrpc: '2.0',
    error: {
      code: error.code,
      message: error.message,
      ...(error.data ? { data: error.data } : {}),
    },
    id,
  };
}

export async function writeJsonRpcErrorResponse(
  req: Request,
  res: Response,
  err: unknown,
  idempotency: IdempotencyResolution | null | undefined,
  deps: JsonRpcErrorResponseDependencies,
): Promise<void> {
  const responseId = extractJsonRpcId(req.body);
  const responseError =
    err instanceof JsonRpcError && deps.responseDialect === 'official-v1'
      ? toOfficialV1JsonRpcError(err, deps.originalMethod)
      : err;
  if (responseError instanceof JsonRpcError) {
    if (
      idempotency?.ownerId &&
      responseError.code !== ErrorCodes.IdempotencyConflict &&
      responseError.code !== ErrorCodes.IdempotencyInProgress
    ) {
      const error = {
        code: responseError.code,
        message: responseError.message,
        ...(responseError.data ? { data: responseError.data } : {}),
      };
      try {
        await completeIdempotency(deps.store, idempotency, { kind: 'error', error }, deps.ttlMs);
      } catch (completionError) {
        logger.error('Failed to finalize idempotent error response', {
          error: completionError,
        });
        res.json(
          createJsonRpcErrorResponse(
            new JsonRpcError(ErrorCodes.InternalError, 'Internal Error'),
            responseId,
          ),
        );
        return;
      }
    }
    res.json(createJsonRpcErrorResponse(responseError, responseId));
    return;
  }

  try {
    await releaseIdempotency(deps.store, idempotency);
  } catch (releaseError) {
    logger.error('Failed to release retryable idempotency reservation', { error: releaseError });
  }
  logger.error('Unhandled internal error', { error: String(err) });
  res.json(
    createJsonRpcErrorResponse(
      new JsonRpcError(ErrorCodes.InternalError, 'Internal Error'),
      responseId,
    ),
  );
}
