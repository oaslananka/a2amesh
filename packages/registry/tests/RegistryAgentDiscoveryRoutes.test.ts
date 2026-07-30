import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  InMemoryRateLimitStore,
  type AgentCard,
} from '@a2amesh/runtime';
import { registerAgentDiscoveryRoutes, routeParam } from '../src/server/agentDiscoveryRoutes.js';
import { createRegistryAuth } from '../src/server/auth.js';
import { createRegistryServerState, type RegistryServerContext } from '../src/server/types.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';

function createAgentCard(name: string, tags: string[] = ['research']): AgentCard {
  return {
    protocolVersion: '1.0',
    name,
    description: `${name} description`,
    url: 'https://agent.example.test',
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
      extendedAgentCard: false,
      mcpCompatible: true,
    },
    skills: [
      {
        id: `${name.toLowerCase().replace(/\s+/g, '-')}-skill`,
        name: 'Research',
        description: 'Search and summarize',
        tags,
        examples: [],
        inputModes: ['text'],
        outputModes: ['text'],
      },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };
}

function registeredAgent(options: {
  id: string;
  name: string;
  tenantId?: string;
  isPublic?: boolean;
  registeredAt?: string;
  tags?: string[];
}): RegisteredAgent {
  const card = createAgentCard(options.name, options.tags);
  return {
    id: options.id,
    url: `https://${options.id}.example.test`,
    card,
    status: 'unknown',
    tags: options.tags ?? ['research'],
    skills: ['Research'],
    registeredAt: options.registeredAt ?? '2026-07-30T00:00:00.000Z',
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    ...(options.isPublic !== undefined ? { isPublic: options.isPublic } : {}),
  };
}

function createHarness() {
  const app = express();
  const context: RegistryServerContext = {
    store: new InMemoryStorage(),
    trustLog: new InMemoryTrustLogStorage(),
    events: new EventEmitter(),
    taskEvents: new EventEmitter(),
    options: { registrationToken: 'registry-secret' },
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
  registerAgentDiscoveryRoutes(app, context, createRegistryAuth(context));
  return { app, context };
}

function authenticated(requestBuilder: request.Test, tenantId: string): request.Test {
  return requestBuilder
    .set('Authorization', 'Bearer registry-secret')
    .set('x-tenant-id', tenantId)
    .set('x-principal-id', `principal-${tenantId}`);
}

describe('registry agent discovery routes', () => {
  it('lists only public agents with deterministic pagination headers', async () => {
    const { app, context } = createHarness();
    await context.store.upsert(
      registeredAgent({
        id: 'public-new',
        name: 'Public New',
        tenantId: 'tenant-b',
        isPublic: true,
        registeredAt: '2026-07-30T02:00:00.000Z',
      }),
    );
    await context.store.upsert(
      registeredAgent({
        id: 'public-old',
        name: 'Public Old',
        tenantId: 'tenant-a',
        isPublic: true,
        registeredAt: '2026-07-30T01:00:00.000Z',
      }),
    );
    await context.store.upsert(
      registeredAgent({ id: 'private', name: 'Private', tenantId: 'tenant-a' }),
    );

    const first = await request(app)
      .get('/agents')
      .query({ public: 'true', limit: '1' })
      .expect(200);

    expect(first.body).toEqual([expect.objectContaining({ id: 'public-new' })]);
    expect(first.headers['x-a2a-registry-page-total']).toBe('2');
    expect(first.headers['x-a2a-registry-page-count']).toBe('1');
    expect(first.headers['x-a2a-registry-page-next-cursor']).toBe('1');

    const second = await request(app)
      .get('/agents')
      .query({ public: 'true', limit: '1', cursor: '1' })
      .expect(200);
    expect(second.body).toEqual([expect.objectContaining({ id: 'public-old' })]);
    expect(second.headers['x-a2a-registry-page-next-cursor']).toBeUndefined();
  });

  it('applies tenant visibility and search filters while recording searches', async () => {
    const { app, context } = createHarness();
    await context.store.upsert(
      registeredAgent({
        id: 'tenant-a-private',
        name: 'Tenant Research',
        tenantId: 'tenant-a',
        tags: ['research', 'finance'],
      }),
    );
    await context.store.upsert(
      registeredAgent({
        id: 'tenant-b-private',
        name: 'Hidden Research',
        tenantId: 'tenant-b',
        tags: ['research'],
      }),
    );
    await context.store.upsert(
      registeredAgent({
        id: 'tenant-b-public',
        name: 'Public Research',
        tenantId: 'tenant-b',
        isPublic: true,
        tags: ['research'],
      }),
    );

    const listed = await authenticated(request(app).get('/agents'), 'tenant-a').expect(200);
    expect(listed.body.map((agent: RegisteredAgent) => agent.id).sort()).toEqual([
      'tenant-a-private',
      'tenant-b-public',
    ]);

    const searched = await authenticated(
      request(app).get('/agents/search').query({ tag: 'finance' }),
      'tenant-a',
    ).expect(200);
    expect(searched.body).toEqual([expect.objectContaining({ id: 'tenant-a-private' })]);
    expect(context.state.metrics.searches).toBe(1);
  });

  it('rejects empty searches with a bounded problem response', async () => {
    const { app, context } = createHarness();

    const response = await authenticated(request(app).get('/agents/search'), 'tenant-a').expect(
      400,
    );

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      title: 'Bad Request',
      status: 400,
      detail: expect.stringContaining('At least one filter'),
    });
    expect(context.state.metrics.searches).toBe(0);
  });

  it('serves public details and enforces tenant access for private agents', async () => {
    const { app, context } = createHarness();
    await context.store.upsert(
      registeredAgent({ id: 'public-agent', name: 'Public Agent', isPublic: true }),
    );
    await context.store.upsert(
      registeredAgent({ id: 'private-agent', name: 'Private Agent', tenantId: 'tenant-a' }),
    );

    await request(app).get('/agents/public-agent').expect(200);
    await request(app).get('/agents/private-agent').expect(401);
    await authenticated(request(app).get('/agents/private-agent'), 'tenant-a').expect(200);
    await authenticated(request(app).get('/agents/private-agent'), 'tenant-b').expect(403);
    await authenticated(request(app).get('/agents/missing'), 'tenant-a').expect(404);

    expect(routeParam(['first', 'second'])).toBe('first');
    expect(routeParam(undefined)).toBeUndefined();
  });
});
