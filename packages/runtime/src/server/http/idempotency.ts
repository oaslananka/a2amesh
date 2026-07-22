import type { Request, Response } from 'express';
import {
  ErrorCodes,
  JsonRpcError,
  type JsonRpcId,
  type JsonRpcRequest,
} from '../../types/jsonrpc.js';
import type { RequestContext } from '../../types/auth.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import {
  buildIdempotencyFingerprint,
  type IdempotencyStoredResult,
  type IdempotencyStore,
} from '../IdempotencyStore.js';
import { attachRequestContext } from '../../auth/index.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_IDEMPOTENCY_LEASE_MS = 30_000;
const MINIMUM_LEASE_RENEW_INTERVAL_MS = 25;

export interface IdempotencyResolution {
  scope: string;
  key: string;
  fingerprint: string;
  ownerId?: string;
  leaseMs?: number;
  replay?: IdempotencyStoredResult;
}

export interface IdempotencyScopeInput {
  method: string;
  tenantId?: string;
  principalId?: string;
  authMethod: string;
}

export interface IdempotencyLeaseController {
  stop(): void;
  ownershipLost(): boolean;
}

export function isIdempotentMethod(method: string): boolean {
  return (
    method === 'message/send' ||
    method === 'message/stream' ||
    method === 'tasks/cancel' ||
    method === 'tasks/pushNotification/set'
  );
}

export function buildIdempotencyScope(input: IdempotencyScopeInput): string {
  return [
    'rpc',
    input.method,
    input.tenantId ?? 'global',
    input.principalId ?? 'anonymous',
    input.authMethod,
  ].join(':');
}

export async function resolveIdempotency(
  req: Request,
  rpcReq: JsonRpcRequest,
  requestContext: RequestContext,
  res: Response,
  store: IdempotencyStore,
  deferReplay = false,
  leaseMs = DEFAULT_IDEMPOTENCY_LEASE_MS,
  runtimeMetrics?: RuntimeMetrics,
): Promise<IdempotencyResolution | null | undefined> {
  if (!isIdempotentMethod(rpcReq.method)) return undefined;

  const key = req.header('idempotency-key');
  if (!key) return undefined;

  const principalScope =
    requestContext.principalId ??
    requestContext.subject ??
    req.ip ??
    req.socket?.remoteAddress ??
    'anonymous';
  const scope = buildIdempotencyScope({
    method: rpcReq.method,
    ...(requestContext.tenantId ? { tenantId: requestContext.tenantId } : {}),
    principalId: principalScope,
    authMethod: requestContext.authMethod,
  });
  const fingerprint = buildIdempotencyFingerprint({
    scope,
    method: rpcReq.method,
    params: rpcReq.params ?? null,
  });

  attachRequestContext(req, {
    ...requestContext,
    idempotency: { key, scope, fingerprint, replayed: false },
  });

  const reservation = await store.reserve(scope, key, fingerprint, leaseMs);
  runtimeMetrics?.recordIdempotencyOutcome(reservation.outcome);

  if (reservation.outcome === 'conflict') {
    logger.warn('Idempotency reservation conflict', {
      method: rpcReq.method,
      outcome: reservation.outcome,
    });
    throw new JsonRpcError(ErrorCodes.IdempotencyConflict, 'Idempotency key reuse conflict');
  }

  if (reservation.outcome === 'in-progress') {
    logger.debug('Idempotent request already in progress', {
      method: rpcReq.method,
      outcome: reservation.outcome,
    });
    throw new JsonRpcError(
      ErrorCodes.IdempotencyInProgress,
      'Idempotent request is already in progress',
      { retryAfterMs: Math.max(reservation.record.expiresAt - Date.now(), 0) },
    );
  }

  if (reservation.outcome === 'replay') {
    const resolution = { scope, key, fingerprint, replay: reservation.record.result };
    if (deferReplay) return resolution;
    writeReplayResponse(rpcReq, res, resolution);
    return null;
  }

  if (reservation.record.state !== 'in-flight') {
    throw new JsonRpcError(ErrorCodes.InternalError, 'Internal Error');
  }
  if (reservation.outcome === 'recovered') {
    logger.warn('Recovered expired idempotency reservation', {
      method: rpcReq.method,
      outcome: reservation.outcome,
    });
  }
  return {
    scope,
    key,
    fingerprint,
    ownerId: reservation.record.ownerId,
    leaseMs,
  };
}

function writeReplayResponse(
  rpcReq: JsonRpcRequest,
  res: Response,
  resolution: IdempotencyResolution & { replay: IdempotencyStoredResult },
): void {
  if (resolution.replay.kind === 'error') {
    res.json({ jsonrpc: '2.0', error: resolution.replay.error, id: rpcReq.id ?? null });
    return;
  }
  res.json({
    jsonrpc: '2.0',
    result: decorateIdempotentResult(resolution.replay.value, resolution, true),
    id: rpcReq.id ?? null,
  });
}

export function startIdempotencyLease(
  resolution: IdempotencyResolution | null | undefined,
  store: IdempotencyStore,
  runtimeMetrics: RuntimeMetrics,
  method: string,
): IdempotencyLeaseController | undefined {
  if (!resolution?.ownerId || !resolution.leaseMs) return undefined;

  const { ownerId, leaseMs } = resolution;
  let stopped = false;
  let lost = false;
  let renewing = false;
  const intervalMs = Math.max(MINIMUM_LEASE_RENEW_INTERVAL_MS, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    if (stopped || renewing || lost) return;
    renewing = true;
    void store
      .renew(resolution.scope, resolution.key, ownerId, leaseMs)
      .then((renewed) => {
        if (stopped) return;
        if (!renewed) {
          lost = true;
          runtimeMetrics.recordIdempotencyOutcome('lease-lost');
          logger.warn('Idempotency reservation lease was lost', {
            method,
            outcome: 'lease-lost',
          });
        }
      })
      .catch((error: unknown) => {
        if (stopped) return;
        lost = true;
        runtimeMetrics.recordIdempotencyOutcome('lease-lost');
        logger.error('Idempotency reservation renewal failed', {
          method,
          outcome: 'lease-lost',
          error,
        });
      })
      .finally(() => {
        renewing = false;
      });
  }, intervalMs);
  timer.unref?.();

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
    ownershipLost(): boolean {
      return lost;
    },
  };
}

export async function completeIdempotency(
  store: IdempotencyStore,
  resolution: IdempotencyResolution,
  result: IdempotencyStoredResult,
  ttlMs: number,
): Promise<void> {
  if (!resolution.ownerId) return;
  await store.complete(resolution.scope, resolution.key, resolution.ownerId, result, ttlMs);
}

export async function releaseIdempotency(
  store: IdempotencyStore,
  resolution: IdempotencyResolution | null | undefined,
): Promise<void> {
  if (!resolution?.ownerId) return;
  await store.release(resolution.scope, resolution.key, resolution.ownerId);
}

export function decorateIdempotentResult(
  result: unknown,
  idempotency: IdempotencyResolution,
  replayed: boolean,
): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;

  const record = {
    key: idempotency.key,
    scope: idempotency.scope,
    fingerprint: idempotency.fingerprint,
    replayed,
  };
  const currentMetadata =
    'metadata' in result && result.metadata && typeof result.metadata === 'object'
      ? (result.metadata as Record<string, unknown>)
      : {};

  return {
    ...result,
    metadata: { ...currentMetadata, idempotency: record },
  };
}

export function extractJsonRpcId(body: unknown): JsonRpcId {
  if (!body || typeof body !== 'object' || !('id' in body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' || id === null ? id : null;
}
