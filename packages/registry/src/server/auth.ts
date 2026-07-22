import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { attachRequestContext, getRequestContext, type RequestContext } from '@a2amesh/runtime';
import type { RegisteredAgent } from '../storage/IAgentStorage.js';
import { writeRegistryProblem } from './problems.js';
import type { RegistryServerContext } from './types.js';

export interface RegistryAuthController {
  authenticateControlPlane(req: Request, res: Response): Promise<RequestContext | null>;
  rejectUnauthenticatedControlPlane(req: Request, res: Response): Promise<boolean>;
  filterAgentsByContext(agents: RegisteredAgent[], context: RequestContext): RegisteredAgent[];
  canAccessAgent(agent: RegisteredAgent, context: RequestContext): boolean;
  shouldEnforceTenantIsolation(context: RequestContext): boolean;
}

export function createRegistryAuth(context: RegistryServerContext): RegistryAuthController {
  const shouldEnforceTenantIsolation = (requestContext: RequestContext): boolean =>
    Boolean(context.authMiddleware) ||
    Boolean(context.options.registrationToken) ||
    context.options.requireAuth === true ||
    requestContext.authMethod !== 'anonymous';

  const canAccessAgent = (agent: RegisteredAgent, requestContext: RequestContext): boolean => {
    if (agent.isPublic) {
      return true;
    }
    if (!shouldEnforceTenantIsolation(requestContext)) {
      return true;
    }
    if (!agent.tenantId) {
      return true;
    }

    return agent.tenantId === requestContext.tenantId;
  };

  const authenticateControlPlane = async (
    req: Request,
    res: Response,
  ): Promise<RequestContext | null> => {
    if (context.authMiddleware) {
      try {
        return await context.authMiddleware.authenticateRequestContext(req);
      } catch {
        writeRegistryProblem(res, 'unauthorized', { detail: 'Unauthorized' });
        return null;
      }
    }

    if (context.options.registrationToken) {
      const authHeader = req.headers.authorization;
      const expected = `Bearer ${context.options.registrationToken}`;
      if (!authHeader || !safeStringEquals(authHeader, expected)) {
        writeRegistryProblem(res, 'unauthorized', { detail: 'Unauthorized' });
        return null;
      }

      const body = req.body as { tenantId?: unknown } | undefined;
      const tenantId =
        req.header('x-tenant-id') ??
        (typeof body?.tenantId === 'string' ? body.tenantId : undefined);
      const principalId = req.header('x-principal-id') ?? 'registry-token';
      const requestContext: RequestContext = {
        requestId: getRequestContext(req).requestId,
        authMethod: 'bearer',
        schemeId: 'registry-token',
        subject: principalId,
        principalId,
        ...(tenantId ? { tenantId } : {}),
        scopes: ['registry:admin'],
        roles: ['registry-admin'],
        claims: {},
      };
      attachRequestContext(req, requestContext);
      return requestContext;
    }

    if (context.options.requireAuth) {
      writeRegistryProblem(res, 'unauthorized', { detail: 'Unauthorized' });
      return null;
    }

    return getRequestContext(req);
  };

  return {
    authenticateControlPlane,
    async rejectUnauthenticatedControlPlane(req: Request, res: Response): Promise<boolean> {
      return (await authenticateControlPlane(req, res)) === null;
    },
    filterAgentsByContext(agents: RegisteredAgent[], requestContext: RequestContext) {
      if (!shouldEnforceTenantIsolation(requestContext)) {
        return agents;
      }

      return agents.filter((agent) => canAccessAgent(agent, requestContext));
    },
    canAccessAgent,
    shouldEnforceTenantIsolation,
  };
}

function safeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
