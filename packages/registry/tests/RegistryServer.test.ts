import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { RegistryServer } from '../src/RegistryServer.js';

describe('RegistryServer', () => {
  let server: RegistryServer;
  const previousNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    vi.restoreAllMocks();
    process.env['NODE_ENV'] = previousNodeEnv;
  });

  it('validates agent URL during registration', async () => {
    server = new RegistryServer({ allowLocalhost: false });

    const response = await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'http://127.0.0.1:3000',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });

    expect(response.status).toBe(400);
    expect(response.header['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'https://a2a-protocol.org/errors/registry/bad-request',
        title: 'Bad Request',
        status: 400,
        detail: expect.stringContaining('Invalid agentUrl'),
      }),
    );
  });

  it('allows registration with safe URL', async () => {
    server = new RegistryServer({ allowLocalhost: false, allowUnresolvedHostnames: true });

    const response = await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'https://example.com/agent',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });

    expect(response.status).toBe(201);
    expect(response.body.url).toBe('https://example.com/agent');
  });

  it('applies outbound policy scheme restrictions during registration', async () => {
    server = new RegistryServer({
      allowLocalhost: true,
      outboundPolicy: { allowLocalhost: true, allowedSchemes: ['https'] },
    });

    const response = await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'http://localhost:3001',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });

    expect(response.status).toBe(400);
    expect(response.header['content-type']).toContain('application/problem+json');
    expect(response.body).toEqual(
      expect.objectContaining({
        type: 'https://a2a-protocol.org/errors/registry/bad-request',
        title: 'Bad Request',
        status: 400,
        detail: expect.stringContaining('Unsupported URL protocol'),
      }),
    );
  });

  it('enforces authentication when required', async () => {
    server = new RegistryServer({
      requireAuth: true,
      registrationToken: 'secret123',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });

    // Without token
    let response = await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'https://example.com',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });
    expect(response.status).toBe(401);

    // With wrong token
    response = await request(server.getExpressApp())
      .post('/agents/register')
      .set('Authorization', 'Bearer wrong')
      .send({
        agentUrl: 'https://example.com',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });
    expect(response.status).toBe(401);

    // With correct token
    response = await request(server.getExpressApp())
      .post('/agents/register')
      .set('Authorization', 'Bearer secret123')
      .send({
        agentUrl: 'https://example.com',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });
    expect(response.status).toBe(201);
  });

  it('applies rate limiting to registry HTTP routes', async () => {
    server = new RegistryServer({
      rateLimit: { maxRequests: 1, windowMs: 60_000 },
    });

    await request(server.getExpressApp()).get('/health').expect(200);
    const second = await request(server.getExpressApp()).get('/health');

    expect(second.status).toBe(429);
    expect(second.body.error).toMatchObject({
      message: 'Too Many Requests',
    });
  });

  it('counts malformed JSON requests against the registry rate limiter', async () => {
    server = new RegistryServer({
      rateLimit: { maxRequests: 1, windowMs: 60_000 },
    });

    await request(server.getExpressApp())
      .post('/agents/register')
      .type('json')
      .send('{"agentUrl":')
      .expect(400);

    const response = await request(server.getExpressApp()).get('/health');

    expect(response.status).toBe(429);
    expect(response.body.error).toMatchObject({
      message: 'Too Many Requests',
    });
  });

  it('restricts non-public catalog access when registry auth is enabled', async () => {
    server = new RegistryServer({
      requireAuth: true,
      registrationToken: 'secret123',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });

    await request(server.getExpressApp())
      .post('/agents/register')
      .set('Authorization', 'Bearer secret123')
      .send({
        agentUrl: 'https://example.com/private',
        tenantId: 'tenant-a',
        agentCard: { name: 'Private', version: '1.0', protocolVersion: '1.0' },
      })
      .expect(201);

    await request(server.getExpressApp())
      .post('/agents/register')
      .set('Authorization', 'Bearer secret123')
      .send({
        agentUrl: 'https://example.com/public',
        isPublic: true,
        agentCard: { name: 'Public', version: '1.0', protocolVersion: '1.0' },
      })
      .expect(201);

    await request(server.getExpressApp()).get('/agents').expect(401);

    const publicResponse = await request(server.getExpressApp())
      .get('/agents')
      .query({ public: 'true' });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body).toHaveLength(1);
    expect(publicResponse.body[0].card.name).toBe('Public');
  });

  it('rejects browser origins in production unless explicitly allowed', async () => {
    process.env['NODE_ENV'] = 'production';
    server = new RegistryServer();

    await request(server.getExpressApp())
      .get('/health')
      .set('Origin', 'https://evil.example')
      .expect(403);

    server = new RegistryServer({ allowedOrigins: ['https://ui.example'] });
    await request(server.getExpressApp())
      .get('/health')
      .set('Origin', 'https://ui.example')
      .expect(200);
  });
});
