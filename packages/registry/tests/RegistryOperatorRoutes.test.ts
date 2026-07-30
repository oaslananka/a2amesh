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
import { createRegistryAuth } from '../src/server/auth.js';
import { createRegistryMetrics } from '../src/server/metrics.js';
import { registerRegistryOperatorRoutes } from '../src/server/registryOperatorRoutes.js';
import { createRegistryServerState, type RegistryServerContext } from '../src/server/types.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';

function createAgent(
  id: string,
  status: RegisteredAgent['status'],
  options: { tenantId?: string; isPublic?: boolean } = {},
): RegisteredAgent {
  const card: AgentCard = {
    protocolVersion: '1.0',
    name: id,
    description: `${id} description`,
    url: `https://${id}.example/a2a`,
    version: '1.0.0',
    capabilities: { streaming: true },
    skills: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };

  return {
    id,
    url: card.url,
    card,
    status,
    tags: [],
    skills: [],
    registeredAt: '2026-07-31T00:00:00.000Z',
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
    ...(typeof options.isPublic === 'boolean' ? { isPublic: options.isPublic } : {}),
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

  const auth = createRegistryAuth(context);
  const metrics = createRegistryMetrics(context);
  registerRegistryOperatorRoutes(app, context, auth, metrics);
  return { app, context };
}

function authorized(builder: request.Test, tenantId?: string): request.Test {
  let next = builder.set('Authorization', 'Bearer token');
  if (tenantId) {
    next = next.set('x-tenant-id', tenantId).set('x-principal-id', `principal-${tenantId}`);
  }
  return next;
}

describe('registry operator routes', () => {
  it('reports agent and healthy-agent counts from storage', async () => {
    const { app, context } = createHarness();
    await context.store.upsert(createAgent('healthy', 'healthy'));
    await context.store.upsert(createAgent('unknown', 'unknown'));

    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      agents: 2,
      healthyAgents: 1,
    });
  });

  it('renders Prometheus metrics and the matching JSON summary', async () => {
    const { app, context } = createHarness();
    context.state.metrics = { registrations: 3, searches: 2, heartbeats: 1 };
    await context.store.upsert(
      createAgent('public-agent', 'healthy', { tenantId: 'tenant-a', isPublic: true }),
    );

    const prometheus = await request(app).get('/metrics').expect(200);
    expect(prometheus.headers['content-type']).toContain('text/plain');
    expect(prometheus.text).toContain('a2a_registry_registrations_total 3');
    expect(prometheus.text).toContain('a2a_registry_healthy_agents 1');

    const summary = await request(app).get('/metrics/summary').expect(200);
    expect(summary.body).toMatchObject({
      registrations: 3,
      searches: 2,
      heartbeats: 1,
      agentCount: 1,
      healthyAgents: 1,
      activeTenants: 1,
      publicAgents: 1,
    });
  });

  it('returns unrestricted anonymous context when tenant isolation is disabled', async () => {
    const { app } = createHarness({
      healthyRecheckIntervalMs: 15_000,
      unhealthyRecheckIntervalMs: 20_000,
      unknownRecheckIntervalMs: 30_000,
    });

    const response = await request(app).get('/context').expect(200);
    expect(response.body).toEqual({
      accessMode: 'authenticated',
      authMethod: 'anonymous',
      tenantId: null,
      visibilityScope: 'all',
      healthStaleAfterMs: 60_000,
    });
  });

  it('returns tenant-aware and tenantless authenticated visibility scopes', async () => {
    const { app } = createHarness({ registrationToken: 'token' });

    const tenant = await authorized(request(app).get('/context'), 'tenant-a').expect(200);
    expect(tenant.body).toEqual({
      accessMode: 'authenticated',
      authMethod: 'bearer',
      tenantId: 'tenant-a',
      visibilityScope: 'tenant-and-public',
      healthStaleAfterMs: 240_000,
    });

    const tenantless = await authorized(request(app).get('/context')).expect(200);
    expect(tenantless.body).toEqual({
      accessMode: 'authenticated',
      authMethod: 'bearer',
      tenantId: null,
      visibilityScope: 'public-and-unassigned',
      healthStaleAfterMs: 240_000,
    });
  });

  it('returns public readonly context without requiring authentication', async () => {
    const { app } = createHarness({ registrationToken: 'token' });

    const response = await request(app).get('/context').query({ public: 'true' }).expect(200);
    expect(response.body).toEqual({
      accessMode: 'readonly-public',
      authMethod: 'anonymous',
      tenantId: null,
      visibilityScope: 'public-only',
      healthStaleAfterMs: 240_000,
    });
  });
});
