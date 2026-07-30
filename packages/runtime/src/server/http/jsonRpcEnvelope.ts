import type { Request } from 'express';
import { ErrorCodes, JsonRpcError, type JsonRpcRequest } from '../../types/jsonrpc.js';
import { makeErrorInfo } from '../../utils/errors.js';
import { normalizeOfficialV1RpcRequest, type A2AJsonRpcDialect } from '../../utils/officialWire.js';
import {
  assertJsonRpcInputLimits,
  DEFAULT_JSON_RPC_INPUT_LIMITS,
  type JsonRpcInputLimits,
} from '../../utils/json-rpc-input-limits.js';
import { validateJsonRpcRequest } from '../../utils/schema-validator.js';
import { assertSupportedA2AProtocolVersion } from './protocolVersion.js';

interface PreparedJsonRpcRequest {
  receivedRpcReq: JsonRpcRequest;
  rpcReq: JsonRpcRequest;
  responseDialect: A2AJsonRpcDialect;
}

export function prepareJsonRpcRequest(
  req: Request,
  inputLimits: JsonRpcInputLimits = DEFAULT_JSON_RPC_INPUT_LIMITS,
): PreparedJsonRpcRequest {
  assertSupportedA2AProtocolVersion(req);

  if (Array.isArray(req.body)) {
    throw new JsonRpcError(
      ErrorCodes.InvalidRequest,
      'Batch requests are not supported',
      makeErrorInfo('INVALID_REQUEST'),
    );
  }

  assertJsonRpcInputLimits(req.body, inputLimits);

  const receivedRpcReq = validateJsonRpcRequest(req.body);
  const normalizedRpcReq = normalizeOfficialV1RpcRequest(
    receivedRpcReq.method,
    receivedRpcReq.params,
  );
  const normalizedParams = normalizedRpcReq.params as JsonRpcRequest['params'];
  const rpcReq: JsonRpcRequest = {
    ...receivedRpcReq,
    method: normalizedRpcReq.method,
    ...(normalizedParams !== undefined ? { params: normalizedParams } : {}),
  };

  return {
    receivedRpcReq,
    rpcReq,
    responseDialect: normalizedRpcReq.officialV1 ? 'official-v1' : 'mesh',
  };
}
