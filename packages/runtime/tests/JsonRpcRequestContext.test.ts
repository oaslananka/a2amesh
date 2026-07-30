import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { JwtAuthMiddleware } from '../src/auth/JwtAuthMiddleware.js';
import { attachRequestContext } from '../src/auth/requestContext.js';
import { resolveJsonRpcRequestContext } from '../src/server/http/jsonRpcRequestContext.js';
import type { RequestContext } from '../src/types/auth.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';

function createRequest(): Request {
  return {
    header: vi.fn().mockReturnValue(undefined),
  } as unknown as Request;
}

function anonymousContext(): RequestContext {
  return {
    requestId: 'request-anonymous',
    authMethod: 'anonymous',
    scopes: [],
    roles: [],
    claims: {},
  };
}

function authenticatedContext(): RequestContext {
  return {
    requestId: 'request-authenticated',
    authMethod: 'bearer',
    schemeId: 'oidc',
    principalId: 'principal-a',
    tenantId: 'tenant-a',
    scopes: ['tasks:read'],
    roles: ['operator'],
    claims: { sub: 'principal-a' },
  };
}

describe('JSON-RPC request context resolution', () => {
  it('returns the attached anonymous context without invoking authentication', async () => {
    const req = createRequest();
    const context = anonymousContext();
    attachRequestContext(req, context);
    const recordAuthReject = vi.fn();

    await expect(resolveJsonRpcRequestContext(req, undefined, { recordAuthReject })).resolves.toBe(
      context,
    );
    expect(recordAuthReject).not.toHaveBeenCalled();
  });

  it('returns the authenticated middleware context without recording a rejection', async () => {
    const req = createRequest();
    const context = authenticatedContext();
    const authenticateRequestContext = vi.fn().mockResolvedValue(context);
    const middleware = { authenticateRequestContext } as unknown as JwtAuthMiddleware;
    const recordAuthReject = vi.fn();

    await expect(resolveJsonRpcRequestContext(req, middleware, { recordAuthReject })).resolves.toBe(
      context,
    );
    expect(authenticateRequestContext).toHaveBeenCalledOnce();
    expect(authenticateRequestContext).toHaveBeenCalledWith(req);
    expect(recordAuthReject).not.toHaveBeenCalled();
  });

  it('records one rejection and replaces middleware errors with Unauthorized', async () => {
    const req = createRequest();
    const authenticateRequestContext = vi
      .fn()
      .mockRejectedValue(new Error('sensitive upstream token detail'));
    const middleware = { authenticateRequestContext } as unknown as JwtAuthMiddleware;
    const recordAuthReject = vi.fn();

    await expect(
      resolveJsonRpcRequestContext(req, middleware, { recordAuthReject }),
    ).rejects.toMatchObject({
      code: ErrorCodes.Unauthorized,
      message: 'Unauthorized',
    });
    expect(recordAuthReject).toHaveBeenCalledOnce();
  });
});
