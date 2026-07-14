import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  getRequestContext,
  type RequestContext,
} from '@a2amesh/runtime';

export type FleetRole = 'viewer' | 'worker' | 'operator' | 'approver' | 'administrator';

export type FleetPermission =
  | 'fleet:workers:read'
  | 'fleet:runs:read'
  | 'fleet:runs:route'
  | 'fleet:runs:approve'
  | 'fleet:runs:complete'
  | 'fleet:runs:cancel'
  | 'fleet:audit:read'
  | 'fleet:events:read';

const ROLE_PERMISSIONS: Readonly<Record<FleetRole, ReadonlySet<FleetPermission>>> = {
  viewer: new Set([
    'fleet:workers:read',
    'fleet:runs:read',
    'fleet:audit:read',
    'fleet:events:read',
  ]),
  worker: new Set(['fleet:runs:read', 'fleet:runs:complete', 'fleet:events:read']),
  operator: new Set([
    'fleet:workers:read',
    'fleet:runs:read',
    'fleet:runs:route',
    'fleet:runs:cancel',
    'fleet:audit:read',
    'fleet:events:read',
  ]),
  approver: new Set([
    'fleet:workers:read',
    'fleet:runs:read',
    'fleet:runs:approve',
    'fleet:audit:read',
    'fleet:events:read',
  ]),
  administrator: new Set([
    'fleet:workers:read',
    'fleet:runs:read',
    'fleet:runs:route',
    'fleet:runs:approve',
    'fleet:runs:complete',
    'fleet:runs:cancel',
    'fleet:audit:read',
    'fleet:events:read',
  ]),
};

const FLEET_ROLES: ReadonlySet<string> = new Set(Object.keys(ROLE_PERMISSIONS));

export interface FleetPrincipal {
  principalId: string;
  tenantId?: string;
  workerId?: string;
  roles: readonly FleetRole[];
  scopes: readonly string[];
  canAccessAllTenants: boolean;
}

export function createDevelopmentPrincipalMiddleware(): RequestHandler {
  return (req, _res, next): void => {
    const anonymous = createAnonymousRequestContext(req);
    const context: RequestContext = {
      ...anonymous,
      subject: 'local-development',
      principalId: 'local-development',
      scopes: ['fleet:*'],
      roles: ['administrator'],
      claims: { developmentMode: true },
    };
    attachRequestContext(req, context);
    next();
  };
}

export function requireFleetPermission(permission: FleetPermission): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = readFleetPrincipal(req);
    if (!principal) {
      sendAuthError(res, 401, 'Authentication is required');
      return;
    }
    if (!hasFleetPermission(principal, permission)) {
      sendAuthError(res, 403, `Missing Fleet permission: ${permission}`);
      return;
    }
    next();
  };
}

export function getFleetPrincipal(req: Request): FleetPrincipal {
  const principal = readFleetPrincipal(req);
  if (!principal) {
    throw new Error('Fleet route executed without an authenticated principal');
  }
  return principal;
}

export function canAccessFleetTenant(
  principal: FleetPrincipal,
  tenantId: string | undefined,
): boolean {
  if (principal.canAccessAllTenants) {
    return true;
  }
  return principal.tenantId === tenantId;
}

export function resolveFleetTenant(
  principal: FleetPrincipal,
  requestedTenantId: string | undefined,
): { allowed: true; tenantId?: string } | { allowed: false } {
  if (principal.canAccessAllTenants) {
    return {
      allowed: true,
      ...((requestedTenantId ?? principal.tenantId)
        ? { tenantId: requestedTenantId ?? principal.tenantId }
        : {}),
    };
  }

  if (requestedTenantId !== undefined && requestedTenantId !== principal.tenantId) {
    return { allowed: false };
  }

  return {
    allowed: true,
    ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
  };
}

export function tenantStorageFilter(principal: FleetPrincipal): string | null | undefined {
  if (principal.canAccessAllTenants) {
    return undefined;
  }
  return principal.tenantId ?? null;
}

function readFleetPrincipal(req: Request): FleetPrincipal | null {
  const context = getRequestContext(req);
  const principalId = context.principalId ?? context.subject;
  if (!principalId || (context.authMethod === 'anonymous' && !context.claims['developmentMode'])) {
    return null;
  }

  const roles = context.roles.filter(isFleetRole);
  const workerId = readStringClaim(context.claims, ['workerId', 'worker_id']);
  return {
    principalId,
    ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    ...(workerId ? { workerId } : {}),
    roles,
    scopes: context.scopes,
    canAccessAllTenants: roles.includes('administrator'),
  };
}

function hasFleetPermission(principal: FleetPrincipal, permission: FleetPermission): boolean {
  if (principal.scopes.includes('fleet:*') || principal.scopes.includes(permission)) {
    return true;
  }
  return principal.roles.some((role) => ROLE_PERMISSIONS[role].has(permission));
}

function readStringClaim(
  claims: Record<string, unknown>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function isFleetRole(value: string): value is FleetRole {
  return FLEET_ROLES.has(value);
}

function sendAuthError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message } });
}
