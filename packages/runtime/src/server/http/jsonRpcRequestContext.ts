import type { Request } from 'express';
import { getRequestContext, type JwtAuthMiddleware } from '../../auth/index.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import type { RequestContext } from '../../types/auth.js';
import { ErrorCodes, JsonRpcError } from '../../types/jsonrpc.js';

export async function resolveJsonRpcRequestContext(
  req: Request,
  authMiddleware: JwtAuthMiddleware | undefined,
  runtimeMetrics: Pick<RuntimeMetrics, 'recordAuthReject'>,
): Promise<RequestContext> {
  if (!authMiddleware) {
    return getRequestContext(req);
  }

  try {
    return await authMiddleware.authenticateRequestContext(req);
  } catch {
    runtimeMetrics.recordAuthReject();
    throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized');
  }
}
