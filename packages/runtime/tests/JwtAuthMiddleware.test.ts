import { createServer } from 'node:http';
import { promises as dns } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { JwtAuthMiddleware } from '../src/auth/JwtAuthMiddleware.js';

function encodeSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('JwtAuthMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('validates api keys from headers', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      apiKeys: { 'api-key': 'secret' },
    });

    const result = await middleware.authenticateRequest({
      header(name: string) {
        return name === 'x-api-key' ? 'secret' : undefined;
      },
      query: {},
    } as never);

    expect(result.schemeId).toBe('api-key');
  });

  it('validates api keys from query parameters', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'query', name: 'api_key' }],
      apiKeys: { 'api-key': ['secret'] },
    });

    const result = await middleware.authenticateRequest({
      header() {
        return undefined;
      },
      query: { api_key: 'secret' },
    } as never);

    expect(result.schemeId).toBe('api-key');
  });

  it('rejects invalid api keys', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      apiKeys: { 'api-key': 'secret' },
    });

    await expect(
      middleware.authenticateRequest({
        header() {
          return 'wrong';
        },
        query: {},
      } as never),
    ).rejects.toThrow('Invalid API key');
  });

  it('rejects bearer tokens when no verifier is configured for http auth schemes', async () => {
    const payload = encodeSegment({ sub: 'user-1' });
    const token = `aaa.${payload}.bbb`;
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'http', id: 'bearer', scheme: 'bearer' }],
    });

    await expect(
      middleware.authenticateRequest({
        header(name: string) {
          return name === 'authorization' ? `Bearer ${token}` : undefined;
        },
        query: {},
      } as never),
    ).rejects.toThrow('Bearer JWT verification is not configured');
  });

  it('verifies bearer tokens for http auth schemes using JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.use = 'sig';
    jwk.kid = 'bearer-key';

    const server = createServer((req, res) => {
      if (req.url === '/jwks') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get bearer JWKS test server address');
    }
    const issuerBaseUrl = `http://127.0.0.1:${address.port}`;

    const token = await new SignJWT({ tenantId: 'tenant-1', scope: 'tasks:read tasks:write' })
      .setProtectedHeader({ alg: 'RS256', kid: 'bearer-key' })
      .setSubject('bearer-user')
      .setIssuer(issuerBaseUrl)
      .setAudience('@a2amesh/runtime')
      .setExpirationTime('2h')
      .sign(privateKey);

    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'http',
          id: 'bearer',
          scheme: 'bearer',
          jwksUri: `${issuerBaseUrl}/jwks`,
          issuer: issuerBaseUrl,
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: { allowLocalhost: true },
    });

    try {
      const result = await middleware.authenticateRequest({
        header(name: string) {
          return name === 'authorization' ? `Bearer ${token}` : undefined;
        },
        query: {},
      } as never);

      expect(result.subject).toBe('bearer-user');
      expect(result.principalId).toBe('bearer-user');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.scopes).toEqual(['tasks:read', 'tasks:write']);

      const tokenWithoutPrincipal = await new SignJWT({ tenantId: 'tenant-1' })
        .setProtectedHeader({ alg: 'RS256', kid: 'bearer-key' })
        .setIssuer(issuerBaseUrl)
        .setAudience('@a2amesh/runtime')
        .setExpirationTime('2h')
        .sign(privateKey);

      await expect(
        middleware.authenticateRequest({
          header(name: string) {
            return name === 'authorization' ? `Bearer ${tokenWithoutPrincipal}` : undefined;
          },
          query: {},
        } as never),
      ).rejects.toThrow('JWT missing principal claim');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns JSON-RPC unauthorized responses from express middleware', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'http', id: 'bearer', scheme: 'bearer' }],
    });
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    const next = vi.fn();

    await middleware.middleware()(
      {
        header() {
          return undefined;
        },
        body: { id: 'rpc-1' },
        query: {},
      } as never,
      response as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: 'rpc-1',
        error: expect.objectContaining({ message: 'Unauthorized' }),
      }),
    );
    expect((response.body as { error: Record<string, unknown> }).error).not.toHaveProperty('data');
    expect(JSON.stringify(response.body)).not.toContain(
      'Bearer JWT verification is not configured',
    );
  });

  it('rejects unknown security schemes in security requirements', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      security: [{ missing: [] }],
      apiKeys: { 'api-key': 'secret' },
    });

    await expect(
      middleware.authenticateRequest({
        header() {
          return 'secret';
        },
        query: {},
      } as never),
    ).rejects.toThrow('Unknown security scheme: missing');
  });

  it('blocks oidc discovery from localhost by default', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'http://127.0.0.1/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
    });

    await expect(
      middleware.authenticateRequest({
        header(name: string) {
          return name === 'authorization' ? 'Bearer a.b.c' : undefined;
        },
        query: {},
      } as never),
    ).rejects.toThrow(/private|not allowed|restricted/i);
  });

  it('honors outbound policy scheme restrictions for oidc discovery', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'http://127.0.0.1/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: { timeoutMs: 5000, allowedSchemes: ['https'] },
    });

    await expect(
      middleware.authenticateRequest({
        header(name: string) {
          return name === 'authorization' ? 'Bearer a.b.c' : undefined;
        },
        query: {},
      } as never),
    ).rejects.toThrow('Unsupported URL protocol');
  });

  it('fetches oidc discovery and jwks through the outbound fetch policy', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.use = 'sig';
    jwk.kid = 'policy-key';
    const issuerBaseUrl = 'https://issuer.invalid';

    vi.spyOn(dns, 'resolve').mockRejectedValue(new Error('dns disabled'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, _init) => {
      const url = input.toString();
      if (url === `${issuerBaseUrl}/.well-known/openid-configuration`) {
        return new Response(
          JSON.stringify({
            issuer: issuerBaseUrl,
            jwks_uri: `${issuerBaseUrl}/jwks`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === `${issuerBaseUrl}/jwks`) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('not found', { status: 404 });
    });

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'policy-key' })
      .setSubject('oidc-policy-user')
      .setIssuer(issuerBaseUrl)
      .setAudience('@a2amesh/runtime')
      .setExpirationTime('2h')
      .sign(privateKey);

    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: `${issuerBaseUrl}/.well-known/openid-configuration`,
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: {
        timeoutMs: 5000,
        retries: 0,
        allowedHostnames: ['issuer.invalid'],
        resolveHostname: async () => ['93.184.216.34'],
      },
    });

    const result = await middleware.authenticateRequest({
      header(name: string) {
        return name === 'authorization' ? `Bearer ${token}` : undefined;
      },
      query: {},
    } as never);

    expect(result.subject).toBe('oidc-policy-user');
    expect(
      fetchSpy.mock.calls.map(([input, init]) => ({
        url: input.toString(),
        hasSignal: init?.signal instanceof AbortSignal,
        redirect: init?.redirect,
        hasDispatcher: Boolean((init as RequestInit & { dispatcher?: unknown })?.dispatcher),
      })),
    ).toEqual([
      {
        url: `${issuerBaseUrl}/.well-known/openid-configuration`,
        hasSignal: true,
        redirect: 'manual',
        hasDispatcher: true,
      },
      {
        url: `${issuerBaseUrl}/jwks`,
        hasSignal: true,
        redirect: 'manual',
        hasDispatcher: true,
      },
    ]);
  });

  it('rejects OIDC discovery redirects to loopback before a second request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'http://127.0.0.1/.well-known/openid-configuration' },
      }),
    );
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'https://issuer.example/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: {
        allowedHostnames: ['issuer.example'],
        resolveHostname: async () => ['93.184.216.34'],
      },
      fetch: fetchMock,
    });

    await expect(
      middleware.authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow(/allowlist|private|not allowed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out oidc discovery requests through the outbound policy', async () => {
    vi.useFakeTimers();
    vi.spyOn(dns, 'resolve').mockRejectedValue(new Error('dns disabled'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init?.signal) {
        throw new Error('fetch policy signal missing');
      }

      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () =>
            reject(
              init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'),
            ),
          { once: true },
        );
      });
    });

    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'https://issuer.invalid/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: {
        timeoutMs: 25,
        retries: 0,
        allowedHostnames: ['issuer.invalid'],
        resolveHostname: async () => ['93.184.216.34'],
      },
    });

    const rejection = middleware
      .authenticateRequest({
        header(name: string) {
          return name === 'authorization' ? 'Bearer a.b.c' : undefined;
        },
        query: {},
      } as never)
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    await vi.advanceTimersByTimeAsync(25);
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Fetch timed out after 25ms');
  });

  it('rejects invalid jwks urls discovered from oidc configuration', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: 'http://issuer.example',
            jwks_uri: 'not-a-url',
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get OIDC test server address');
    }

    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: `http://127.0.0.1:${address.port}/.well-known/openid-configuration`,
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: { allowLocalhost: true },
    });

    try {
      await expect(
        middleware.authenticateRequest({
          header(name: string) {
            return name === 'authorization' ? 'Bearer a.b.c' : undefined;
          },
          query: {},
        } as never),
      ).rejects.toThrow('Invalid URL');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('validates oidc tokens through discovery and jwks', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.use = 'sig';
    jwk.kid = 'test-key';

    let issuerBaseUrl = '';
    const server = createServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            issuer: issuerBaseUrl,
            jwks_uri: `${issuerBaseUrl}/jwks`,
          }),
        );
        return;
      }

      if (req.url === '/jwks') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get OIDC test server address');
    }
    issuerBaseUrl = `http://127.0.0.1:${address.port}`;

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('oidc-user')
      .setIssuer(issuerBaseUrl)
      .setAudience('@a2amesh/runtime')
      .setExpirationTime('2h')
      .sign(privateKey);

    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: `${issuerBaseUrl}/.well-known/openid-configuration`,
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: { allowLocalhost: true },
    });

    try {
      const result = await middleware.authenticateRequest({
        header(name: string) {
          return name === 'authorization' ? `Bearer ${token}` : undefined;
        },
        query: {},
      } as never);

      expect(result.subject).toBe('oidc-user');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('fails when oidc discovery omits the jwks uri', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ issuer: 'http://issuer.example' }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get OIDC test server address');
    }

    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: `http://127.0.0.1:${address.port}/.well-known/openid-configuration`,
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: { allowLocalhost: true },
    });

    try {
      await expect(
        middleware.authenticateRequest({
          header(name: string) {
            return name === 'authorization' ? 'Bearer a.b.c' : undefined;
          },
          query: {},
        } as never),
      ).rejects.toThrow('OIDC configuration is missing jwks_uri');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('attaches authenticated request context for api key credentials', async () => {
    const req = {
      header(name: string) {
        return name === 'x-api-key' ? 'tenant-secret' : undefined;
      },
      query: {},
    } as never as Record<string, unknown> & {
      header(name: string): string | undefined;
      query: Record<string, string>;
    };
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      apiKeys: {
        'api-key': {
          value: 'tenant-secret',
          principalId: 'principal-1',
          tenantId: 'tenant-1',
          scopes: ['tasks:read'],
          roles: ['operator'],
          claims: { plan: 'pro' },
        },
      },
    });

    const context = await middleware.authenticateRequestContext(req as never);

    expect(context.principalId).toBe('principal-1');
    expect(context.tenantId).toBe('tenant-1');
    expect((req['auth'] as { roles: string[] }).roles).toEqual(['operator']);
  });

  it('passes successful express middleware authentication to next', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      apiKeys: { 'api-key': 'secret' },
    });
    const req = {
      header(name: string) {
        return name === 'x-api-key' ? 'secret' : undefined;
      },
      body: { id: 'rpc-1' },
      query: {},
    } as never as Record<string, unknown>;
    const next = vi.fn();
    const response = { status: vi.fn(), json: vi.fn() };

    await middleware.middleware()(req as never, response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req['auth']).toEqual(expect.objectContaining({ principalId: 'api-key:api-key' }));
  });

  it('requires every scheme in a compound security requirement', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        { type: 'apiKey', id: 'primary', in: 'header', name: 'x-primary-key' },
        { type: 'apiKey', id: 'secondary', in: 'header', name: 'x-secondary-key' },
      ],
      security: [{ primary: [], secondary: [] }],
      apiKeys: {
        primary: {
          value: 'primary-secret',
          principalId: 'principal-1',
          tenantId: 'tenant-1',
        },
        secondary: {
          value: 'secondary-secret',
          principalId: 'principal-1',
          tenantId: 'tenant-1',
        },
      },
    });

    await expect(
      middleware.authenticateRequest({
        header(name: string) {
          return name === 'x-primary-key' ? 'primary-secret' : undefined;
        },
        query: {},
      } as never),
    ).rejects.toThrow('Invalid API key');

    const result = await middleware.authenticateRequest({
      header(name: string) {
        if (name === 'x-primary-key') return 'primary-secret';
        if (name === 'x-secondary-key') return 'secondary-secret';
        return undefined;
      },
      query: {},
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        schemeId: 'primary',
        principalId: 'principal-1',
        tenantId: 'tenant-1',
      }),
    );
  });

  it('enforces scopes declared by a security requirement', async () => {
    const createMiddleware = (scopes: string[]) =>
      new JwtAuthMiddleware({
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        security: [{ 'api-key': ['tasks:admin'] }],
        apiKeys: {
          'api-key': {
            value: 'secret',
            principalId: 'principal-1',
            scopes,
          },
        },
      });
    const request = {
      header(name: string) {
        return name === 'x-api-key' ? 'secret' : undefined;
      },
      query: {},
    } as never;

    await expect(createMiddleware(['tasks:read']).authenticateRequest(request)).rejects.toThrow(
      'Insufficient scope',
    );

    await expect(
      createMiddleware(['tasks:read', 'tasks:admin']).authenticateRequest(request),
    ).resolves.toEqual(expect.objectContaining({ principalId: 'principal-1' }));
  });

  it('rejects compound credentials bound to different principals', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        { type: 'apiKey', id: 'primary', in: 'header', name: 'x-primary-key' },
        { type: 'apiKey', id: 'secondary', in: 'header', name: 'x-secondary-key' },
      ],
      security: [{ primary: [], secondary: [] }],
      apiKeys: {
        primary: { value: 'primary-secret', principalId: 'principal-1' },
        secondary: { value: 'secondary-secret', principalId: 'principal-2' },
      },
    });

    await expect(
      middleware.authenticateRequest({
        header(name: string) {
          if (name === 'x-primary-key') return 'primary-secret';
          if (name === 'x-secondary-key') return 'secondary-secret';
          return undefined;
        },
        query: {},
      } as never),
    ).rejects.toThrow('Conflicting authenticated principals');
  });

  it('rejects compound credentials bound to different tenants', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        { type: 'apiKey', id: 'primary', in: 'header', name: 'x-primary-key' },
        { type: 'apiKey', id: 'secondary', in: 'header', name: 'x-secondary-key' },
      ],
      security: [{ primary: [], secondary: [] }],
      apiKeys: {
        primary: {
          value: 'primary-secret',
          principalId: 'principal-1',
          tenantId: 'tenant-1',
        },
        secondary: {
          value: 'secondary-secret',
          principalId: 'principal-1',
          tenantId: 'tenant-2',
        },
      },
    });

    await expect(
      middleware.authenticateRequest({
        header(name: string) {
          if (name === 'x-primary-key') return 'primary-secret';
          if (name === 'x-secondary-key') return 'secondary-secret';
          return undefined;
        },
        query: {},
      } as never),
    ).rejects.toThrow('Conflicting authenticated tenants');
  });

  it('continues to the next security requirement after a failed requirement', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
      security: [{ missing: [] }, { 'api-key': [] }],
      apiKeys: { 'api-key': 'secret' },
    });

    const result = await middleware.authenticateRequest({
      header(name: string) {
        return name === 'x-api-key' ? 'secret' : undefined;
      },
      query: {},
    } as never);

    expect(result.schemeId).toBe('api-key');
  });

  it('rejects missing and unconfigured api keys', async () => {
    const unconfigured = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
    });
    await expect(
      unconfigured.authenticateRequest({ header: () => 'secret', query: {} } as never),
    ).rejects.toThrow('No API key configured');

    const missing = new JwtAuthMiddleware({
      securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'query', name: 'api_key' }],
      apiKeys: { 'api-key': 'secret' },
    });
    await expect(
      missing.authenticateRequest({
        header: () => undefined,
        query: { api_key: ['secret'] },
      } as never),
    ).rejects.toThrow('Invalid API key');
  });

  it('enforces outbound hostname policies before OIDC discovery fetches', async () => {
    const makeMiddleware = (openIdConnectUrl: string, outboundPolicy: Record<string, unknown>) =>
      new JwtAuthMiddleware({
        securitySchemes: [
          {
            type: 'openIdConnect',
            id: 'oidc',
            openIdConnectUrl,
            audience: '@a2amesh/runtime',
          },
        ],
        outboundPolicy: outboundPolicy as never,
        fetch: vi.fn(async () => new Response('{}', { status: 503 })) as never,
      });

    await expect(
      makeMiddleware('not a url', {}).authenticateRequest({
        header: () => 'Bearer a.b.c',
        query: {},
      } as never),
    ).rejects.toThrow(/Invalid URL/);

    await expect(
      makeMiddleware('https://metadata.internal/.well-known/openid-configuration', {
        resolveHostname: async () => ['10.0.0.1'],
      }).authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow(/private|not allowed|restricted/i);

    await expect(
      makeMiddleware('https://unresolved.example/.well-known/openid-configuration', {
        resolveHostname: async () => {
          throw new Error('dns failed');
        },
      }).authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow('Hostname could not be resolved');

    await expect(
      makeMiddleware('https://allowed.example/.well-known/openid-configuration', {
        allowedHostnames: ['allowed.example'],
        resolveHostname: async () => ['93.184.216.34'],
      }).authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow('Failed to fetch OIDC configuration: 503');
  });

  it.each([
    ['10.1.2.3'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.1.1'],
    ['169.254.1.1'],
    ['100.64.0.1'],
    ['0.0.0.0'],
    ['::ffff:127.0.0.1'],
    ['fe80::1'],
    ['fc00::1'],
    ['fd00::1'],
  ])('rejects restricted DNS answers for auth outbound host %s', async (address) => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'https://metadata.internal/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: {
        resolveHostname: async () => [address],
      },
      fetch: vi.fn(async () => new Response('{}', { status: 503 })) as never,
    });

    await expect(
      middleware.authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow(/private|not allowed|restricted/i);
  });

  it.each([['8.8.8.8'], ['172.32.0.1'], ['100.128.0.1'], ['2001:db8::1']])(
    'allows public DNS answers for auth outbound host %s',
    async (address) => {
      const middleware = new JwtAuthMiddleware({
        securitySchemes: [
          {
            type: 'openIdConnect',
            id: 'oidc',
            openIdConnectUrl: 'https://issuer.example/.well-known/openid-configuration',
            audience: '@a2amesh/runtime',
          },
        ],
        outboundPolicy: {
          resolveHostname: async () => [address],
        },
        fetch: vi.fn(async () => new Response('{}', { status: 503 })) as never,
      });

      await expect(
        middleware.authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
      ).rejects.toThrow('Failed to fetch OIDC configuration: 503');
    },
  );

  it('allows restricted auth outbound addresses when explicitly configured', async () => {
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'https://metadata.internal/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: {
        allowNetworkTargets: true,
        resolveHostname: async () => ['10.1.2.3'],
      },
      fetch: vi.fn(async () => new Response('{}', { status: 503 })) as never,
    });

    await expect(
      middleware.authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow('Failed to fetch OIDC configuration: 503');
  });

  it('retries transient OIDC discovery responses according to outbound policy', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('retry', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('{"issuer":"https://issuer.example"}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const middleware = new JwtAuthMiddleware({
      securitySchemes: [
        {
          type: 'openIdConnect',
          id: 'oidc',
          openIdConnectUrl: 'https://issuer.example/.well-known/openid-configuration',
          audience: '@a2amesh/runtime',
        },
      ],
      outboundPolicy: {
        retries: 1,
        allowedHostnames: ['issuer.example'],
        resolveHostname: async () => ['93.184.216.34'],
      },
      fetch: fetchMock,
    });

    await expect(
      middleware.authenticateRequest({ header: () => 'Bearer a.b.c', query: {} } as never),
    ).rejects.toThrow('OIDC configuration is missing jwks_uri');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
