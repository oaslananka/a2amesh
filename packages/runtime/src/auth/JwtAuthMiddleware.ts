/**
 * @file JwtAuthMiddleware.ts
 * Runtime authentication middleware backed by OIDC discovery, JWKS and API keys.
 */

import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, customFetch } from 'jose';
import {
  attachRequestContext,
  createAuthenticatedRequestContext,
  type RequestWithContext,
} from './requestContext.js';
import type {
  ApiKeyCredential,
  ApiKeyCredentialSource,
  AuthScheme,
  AuthValidationResult,
  HttpAuthScheme,
  OpenIdConnectAuthScheme,
  RequestContext,
} from '@a2amesh/protocol';
import { createOutboundPolicyFetch, type OutboundPolicyOptions } from '../net/OutboundPolicy.js';

export interface JwtAuthOutboundPolicyOptions {
  timeoutMs?: number;
  retries?: number;
  allowedSchemes?: readonly string[];
  allowLocalhost?: boolean;
  allowNetworkTargets?: boolean;
  allowUnresolvedHostnames?: boolean;
  allowedHostnames?: readonly string[];
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

const DEFAULT_AUTH_OUTBOUND_TIMEOUT_MS = 5000;

export interface JwtAuthMiddlewareOptions {
  securitySchemes: AuthScheme[];
  security?: Record<string, string[]>[];
  apiKeys?: ApiKeyCredentialSource;
  outboundPolicy?: JwtAuthOutboundPolicyOptions;
  fetch?: typeof fetch;
}

/**
 * Authentication middleware that evaluates A2A security schemes against incoming requests.
 *
 * Supports API keys, HTTP bearer tokens, and OIDC discovery with JWKS validation.
 *
 * @since 1.0.0
 */
export class JwtAuthMiddleware {
  private readonly remoteSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: JwtAuthMiddlewareOptions) {
    this.fetchFn = createOutboundPolicyFetch(this.createAuthOutboundPolicy());
  }

  async authenticateRequest(req: ExpressRequest): Promise<AuthValidationResult> {
    const securityRequirements =
      this.options.security && this.options.security.length > 0
        ? this.options.security
        : [Object.fromEntries(this.options.securitySchemes.map((scheme) => [scheme.id, []]))];

    let lastError: Error | undefined;
    for (const requirement of securityRequirements) {
      try {
        for (const schemeId of Object.keys(requirement)) {
          const scheme = this.options.securitySchemes.find((item) => item.id === schemeId);
          if (!scheme) {
            throw new Error(`Unknown security scheme: ${schemeId}`);
          }

          if (scheme.type === 'apiKey') {
            return this.validateApiKey(req, scheme);
          }

          if (scheme.type === 'http') {
            return this.validateBearerToken(req, scheme);
          }

          if (scheme.type === 'openIdConnect') {
            return this.validateOidcToken(req, scheme);
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error('Authentication failed');
  }

  async authenticateRequestContext(req: ExpressRequest): Promise<RequestContext> {
    const authResult = await this.authenticateRequest(req);
    const context = createAuthenticatedRequestContext(req, authResult);
    attachRequestContext(req, context);
    Object.assign(req, { auth: authResult });
    return context;
  }

  middleware() {
    return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction): Promise<void> => {
      try {
        const authResult = await this.authenticateRequest(req);
        const context = createAuthenticatedRequestContext(req, authResult);
        attachRequestContext(req, context);
        Object.assign(req as RequestWithContext, { auth: authResult });
        next();
      } catch (error) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32040,
            message: 'Unauthorized',
            data: { reason: String(error) },
          },
          id: req.body && typeof req.body === 'object' && 'id' in req.body ? req.body.id : null,
        });
      }
    };
  }

  private validateApiKey(
    req: ExpressRequest,
    scheme: Extract<AuthScheme, { type: 'apiKey' }>,
  ): AuthValidationResult {
    const expected = this.options.apiKeys?.[scheme.id];
    const credentials = this.normalizeApiKeyCredentials(expected);
    if (credentials.length === 0) {
      throw new Error(`No API key configured for scheme ${scheme.id}`);
    }

    const incoming =
      scheme.in === 'header'
        ? req.header(scheme.name)
        : typeof req.query[scheme.name] === 'string'
          ? req.query[scheme.name]
          : undefined;

    if (typeof incoming !== 'string') {
      throw new Error('Invalid API key');
    }

    const matched = credentials.find((credential) =>
      this.safeStringEquals(credential.value, incoming),
    );
    if (!matched) {
      throw new Error('Invalid API key');
    }

    return {
      schemeId: scheme.id,
      authMethod: 'apiKey',
      subject: matched.principalId ?? `api-key:${scheme.id}`,
      principalId: matched.principalId ?? `api-key:${scheme.id}`,
      ...(matched.tenantId ? { tenantId: matched.tenantId } : {}),
      scopes: matched.scopes ?? [],
      roles: matched.roles ?? [],
      claims: matched.claims ?? {},
    };
  }

  private async validateOidcToken(
    req: ExpressRequest,
    scheme: OpenIdConnectAuthScheme,
  ): Promise<AuthValidationResult> {
    const token = this.readBearerToken(req);

    const discoveryResponse = await this.fetchWithAuthPolicy(scheme.openIdConnectUrl);

    if (!discoveryResponse.ok) {
      await discoveryResponse.body?.cancel().catch(() => undefined);
      throw new Error(`Failed to fetch OIDC configuration: ${discoveryResponse.status}`);
    }

    const discovery = (await discoveryResponse.json()) as {
      issuer?: string;
      jwks_uri?: string;
    };
    const jwksUri = scheme.jwksUri ?? discovery.jwks_uri;
    if (!jwksUri) {
      throw new Error('OIDC configuration is missing jwks_uri');
    }

    const remoteSet = await this.getRemoteSet(jwksUri);

    const verifyOptions = {
      ...(scheme.audience ? { audience: scheme.audience } : {}),
      ...((scheme.issuer ?? discovery.issuer) ? { issuer: scheme.issuer ?? discovery.issuer } : {}),
      algorithms: scheme.algorithms ?? ['RS256', 'ES256'],
    };

    const { payload } = await jwtVerify(token, remoteSet, verifyOptions);

    return this.resultFromJwtPayload({
      schemeId: scheme.id,
      authMethod: 'oidc',
      payload,
      ...((scheme.issuer ?? discovery.issuer) ? { issuer: scheme.issuer ?? discovery.issuer } : {}),
      ...(scheme.audience ? { audience: scheme.audience } : {}),
    });
  }

  private async validateBearerToken(
    req: ExpressRequest,
    scheme: HttpAuthScheme,
  ): Promise<AuthValidationResult> {
    if (!scheme.jwksUri) {
      throw new Error('Bearer JWT verification is not configured');
    }

    const token = this.readBearerToken(req);
    const { payload } = await jwtVerify(token, await this.getRemoteSet(scheme.jwksUri), {
      ...(scheme.audience ? { audience: scheme.audience } : {}),
      ...(scheme.issuer ? { issuer: scheme.issuer } : {}),
      algorithms: scheme.algorithms ?? ['RS256', 'ES256'],
    });

    return this.resultFromJwtPayload({
      schemeId: scheme.id,
      authMethod: 'bearer',
      payload,
      ...(scheme.issuer ? { issuer: scheme.issuer } : {}),
      ...(scheme.audience ? { audience: scheme.audience } : {}),
    });
  }

  private async getRemoteSet(jwksUri: string): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const jwksUrl = new URL(jwksUri);
    const cacheKey = jwksUrl.toString();
    let remoteSet = this.remoteSets.get(cacheKey);
    if (!remoteSet) {
      remoteSet = createRemoteJWKSet(jwksUrl, {
        timeoutDuration: this.options.outboundPolicy?.timeoutMs ?? DEFAULT_AUTH_OUTBOUND_TIMEOUT_MS,
        [customFetch]: async (url, init) => this.fetchWithAuthPolicy(url, init),
      });
      this.remoteSets.set(cacheKey, remoteSet);
    }

    return remoteSet;
  }

  private async fetchWithAuthPolicy(
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ): Promise<globalThis.Response> {
    return this.fetchFn(input, init);
  }

  private createAuthOutboundPolicy(): OutboundPolicyOptions {
    const policy = this.options.outboundPolicy;
    return {
      timeoutMs: policy?.timeoutMs ?? DEFAULT_AUTH_OUTBOUND_TIMEOUT_MS,
      ...(policy?.retries !== undefined ? { retries: policy.retries } : {}),
      ...(policy?.allowedSchemes !== undefined ? { allowedSchemes: policy.allowedSchemes } : {}),
      ...(policy?.allowLocalhost !== undefined ? { allowLocalhost: policy.allowLocalhost } : {}),
      ...(policy?.allowNetworkTargets !== undefined
        ? { allowPrivateNetworks: policy.allowNetworkTargets }
        : {}),
      ...(policy?.allowUnresolvedHostnames !== undefined
        ? { allowUnresolvedHostnames: policy.allowUnresolvedHostnames }
        : {}),
      ...(policy?.allowedHostnames !== undefined
        ? { allowedHostnames: [...policy.allowedHostnames] }
        : {}),
      ...(policy?.resolveHostname !== undefined ? { resolveHostname: policy.resolveHostname } : {}),
      ...(this.options.fetch ? { fetchImplementation: this.options.fetch } : {}),
      telemetryLabels: {
        'a2a.operation': 'auth-key-discovery',
      },
    };
  }

  private resultFromJwtPayload(args: {
    schemeId: string;
    authMethod: 'bearer' | 'oidc';
    payload: JWTPayload;
    issuer?: string;
    audience?: string | string[];
  }): AuthValidationResult {
    const claims = args.payload as unknown as Record<string, unknown>;
    const principalId = this.readStringClaim(claims, ['principalId', 'sub', 'client_id', 'azp']);
    if (!principalId) {
      throw new Error('JWT missing principal claim');
    }
    const tenantId = this.readStringClaim(claims, ['tenantId', 'tenant_id', 'org_id']);
    const scopes = this.readStringListClaim(claims, ['scope', 'scp', 'scopes']);
    const roles = this.readStringListClaim(claims, ['roles', 'role']);

    return {
      schemeId: args.schemeId,
      authMethod: args.authMethod,
      subject: args.payload.sub ?? principalId,
      principalId,
      ...(tenantId ? { tenantId } : {}),
      scopes,
      roles,
      ...(args.issuer ? { issuer: args.issuer } : {}),
      ...(args.audience ? { audience: args.audience } : {}),
      claims,
    };
  }

  private readBearerToken(req: ExpressRequest): string {
    const header = req.header('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new Error('Missing bearer token');
    }

    return header.slice('bearer '.length).trim();
  }

  private normalizeApiKeyCredentials(
    expected: ApiKeyCredentialSource[string] | undefined,
  ): ApiKeyCredential[] {
    const values = Array.isArray(expected) ? expected : expected ? [expected] : [];
    return values.map((value) =>
      typeof value === 'string'
        ? { value }
        : {
            value: value.value,
            ...(value.principalId ? { principalId: value.principalId } : {}),
            ...(value.tenantId ? { tenantId: value.tenantId } : {}),
            ...(value.scopes ? { scopes: value.scopes } : {}),
            ...(value.roles ? { roles: value.roles } : {}),
            ...(value.claims ? { claims: value.claims } : {}),
          },
    );
  }

  private safeStringEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private readStringClaim(claims: Record<string, unknown>, names: string[]): string | undefined {
    for (const name of names) {
      const value = claims[name];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    return undefined;
  }

  private readStringListClaim(claims: Record<string, unknown>, names: string[]): string[] {
    for (const name of names) {
      const value = claims[name];
      if (typeof value === 'string' && value.length > 0) {
        return value.split(' ').filter(Boolean);
      }
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
      }
    }

    return [];
  }
}
