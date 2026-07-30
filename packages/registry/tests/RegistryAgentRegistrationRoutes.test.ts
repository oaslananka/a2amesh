import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  hashAgentCard,
  InMemoryRateLimitStore,
  signAgentCard,
  type AgentCard,
  type SigningKey,
  type VerificationKey,
} from '@a2amesh/runtime';
import { registerAgentRegistrationRoutes } from '../src/server/agentRegistrationRoutes.js';
import { createRegistryAuth } from '../src/server/auth.js';
import { createRegistryServerState, type RegistryServerContext } from '../src/server/types.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';

function createAgentCard(name: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name,
    description: `${name} description`,
    url: 'http://localhost:0',
    version: '1.0.0',
    capabilities: { streaming: true },
    skills: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };
}

function createEs256KeyPair(keyId = 'registry-test-key') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    signingKey: {
      keyId,
      algorithm: 'ES256' as const,
      privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    } satisfies SigningKey,
    verificationKey: {
      keyId,
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    } satisfies VerificationKey,
  };
}

function createHarness(options: RegistryServerContext['options'] = {}) {
  const app = express();
  const context: RegistryServerContext = {
    store: options.storage ?? new InMemoryStorage(),
    trustLog: options.trustLogStorage ?? new InMemoryTrustLogStorage(),
    events: new EventEmitter(),
    taskEvents: new EventEmitter(),
    options,
    authMiddleware: undefined,
    rateLimitStore: new InMemoryRateLimitStore(),
    recentTasks: new Map(),
    taskVersions: new Map(),
    nextHealthCheckAt: new Map(),
    nextTaskPollAt: new Map(),
    sseClients: new Set(),
    state: createRegistryServerState(),
  };

  app.use((req, _res, next) => {
    attachRequestContext(req, createAnonymousRequestContext(req));
    next();
  });
  app.use(express.json());
  registerAgentRegistrationRoutes(app, context, createRegistryAuth(context));
  return { app, context };
}

function authenticated(builder: request.Test, tenantId: string): request.Test {
  return builder
    .set('Authorization', 'Bearer token')
    .set('x-tenant-id', tenantId)
    .set('x-principal-id', `principal-${tenantId}`);
}

describe('registry agent registration and trust routes', () => {
  it('registers a safe unsigned card and emits the existing registry event', async () => {
    const { app, context } = createHarness({
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });
    const events: unknown[] = [];
    context.events.on('registry_update', (event) => events.push(event));

    const response = await request(app)
      .post('/agents/register')
      .send({ agentUrl: 'http://localhost:3001', agentCard: createAgentCard('Unsigned') })
      .expect(201);

    expect(response.body).toMatchObject({
      url: 'http://localhost:3001',
      verification: { state: 'unverified', valid: false },
    });
    expect(context.state.metrics.registrations).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'registered',
        agent: expect.objectContaining({ id: response.body.id }),
      }),
    ]);
  });

  it('rejects public registration when the tenant policy disallows it', async () => {
    const { app } = createHarness({
      registrationToken: 'token',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
      tenantTrustPolicies: { 'tenant-a': { allowPublicAgents: false } },
    });

    const response = await authenticated(
      request(app)
        .post('/admin/agents/register')
        .send({
          agentUrl: 'http://localhost:3002',
          agentCard: createAgentCard('Private Only'),
          isPublic: true,
        }),
      'tenant-a',
    ).expect(403);

    expect(response.body).toMatchObject({
      detail: 'Public agent registration is disabled for this tenant',
    });
  });

  it('journals trusted cards and serves filtered and limited trust-log queries', async () => {
    const { signingKey, verificationKey } = createEs256KeyPair();
    const { app } = createHarness({
      registrationToken: 'token',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
      tenantTrustPolicies: {
        'tenant-trust': {
          requireSignedAgentCards: true,
          trustedAgentCardKeys: [verificationKey],
        },
      },
    });

    const firstCard = await signAgentCard(createAgentCard('Trusted One'), signingKey);
    const secondCard = await signAgentCard(createAgentCard('Trusted Two'), signingKey);
    await authenticated(
      request(app).post('/agents/register').send({
        agentUrl: 'http://localhost:3003',
        agentCard: firstCard,
      }),
      'tenant-trust',
    ).expect(201);
    await authenticated(
      request(app).post('/agents/register').send({
        agentUrl: 'http://localhost:3004',
        agentCard: secondCard,
      }),
      'tenant-trust',
    ).expect(201);

    const full = await request(app).get('/trust-log').expect(200);
    expect(full.body).toHaveLength(2);
    const limited = await request(app).get('/trust-log').query({ limit: '1' }).expect(200);
    expect(limited.body).toHaveLength(1);
    const filtered = await request(app)
      .get(`/trust-log/${hashAgentCard(firstCard)}`)
      .expect(200);
    expect(filtered.body).toEqual([
      expect.objectContaining({ agentUrl: 'http://localhost:3003', keyId: signingKey.keyId }),
    ]);
  });

  it('rejects unsigned cards when tenant trust requires signatures', async () => {
    const { app } = createHarness({
      registrationToken: 'token',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
      tenantTrustPolicies: { 'tenant-required': { requireSignedAgentCards: true } },
    });

    const response = await authenticated(
      request(app)
        .post('/agents/register')
        .send({
          agentUrl: 'http://localhost:3005',
          agentCard: createAgentCard('Unsigned Required'),
        }),
      'tenant-required',
    ).expect(403);

    expect(response.body).toMatchObject({ detail: 'Agent Card signature is required' });
    expect((await request(app).get('/trust-log').expect(200)).body).toEqual([]);
  });
});
