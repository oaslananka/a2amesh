import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  InMemoryRateLimitStore,
  REGISTRY_EXPORT_SCHEMA_ID,
  RegistryExportDocumentSchema,
  type AgentCard,
  type RegistryExportDocument,
} from '@a2amesh/runtime';
import { createRegistryAuth } from '../src/server/auth.js';
import { registerRegistryImportExportRoutes } from '../src/server/registryImportExportRoutes.js';
import { createRegistryServerState, type RegistryServerContext } from '../src/server/types.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';

function createAgentCard(name: string, url: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name,
    description: `${name} description`,
    url,
    version: '1.0.0',
    capabilities: { streaming: true },
    skills: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: [],
  };
}

function registeredAgent(
  id: string,
  url: string,
  options: { tenantId?: string; isPublic?: boolean } = {},
): RegisteredAgent {
  return {
    id,
    url,
    card: createAgentCard(id, url),
    status: 'unknown',
    tags: [],
    skills: [],
    registeredAt: '2026-07-30T12:00:00.000Z',
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
  registerRegistryImportExportRoutes(app, context, createRegistryAuth(context));
  return { app, context };
}

function authorized(builder: request.Test, tenantId?: string): request.Test {
  let next = builder.set('Authorization', 'Bearer token');
  if (tenantId) {
    next = next.set('x-tenant-id', tenantId).set('x-principal-id', `principal-${tenantId}`);
  }
  return next;
}

function exportDocument(agents: RegisteredAgent[]): RegistryExportDocument {
  return {
    $schema: REGISTRY_EXPORT_SCHEMA_ID,
    schemaVersion: '1',
    exportedAt: '2026-07-30T12:00:00.000Z',
    agents,
    metadata: {
      source: 'a2amesh-registry',
      agentCount: agents.length,
      tenants: Array.from(
        new Set(agents.map((agent) => agent.tenantId).filter((value): value is string => !!value)),
      ).sort(),
      publicAgents: agents.filter((agent) => agent.isPublic === true).length,
    },
  };
}

describe('registry import and export routes', () => {
  it('exports tenant-visible agents with deterministic metadata', async () => {
    const { app, context } = createHarness({ registrationToken: 'token' });
    await context.store.upsert(
      registeredAgent('tenant-a-private', 'https://tenant-a.example/a2a', {
        tenantId: 'tenant-a',
      }),
    );
    await context.store.upsert(
      registeredAgent('tenant-b-private', 'https://tenant-b.example/a2a', {
        tenantId: 'tenant-b',
      }),
    );
    await context.store.upsert(
      registeredAgent('tenant-b-public', 'https://public.example/a2a', {
        tenantId: 'tenant-b',
        isPublic: true,
      }),
    );

    const response = await authorized(request(app).get('/admin/agents/export'), 'tenant-a').expect(
      200,
    );
    const document = RegistryExportDocumentSchema.parse(response.body);

    expect(document.agents.map((agent) => agent.id).sort()).toEqual([
      'tenant-a-private',
      'tenant-b-public',
    ]);
    expect(document.metadata).toEqual({
      source: 'a2amesh-registry',
      agentCount: 2,
      tenants: ['tenant-a', 'tenant-b'],
      publicAgents: 1,
    });
  });

  it('returns bounded schema issues for invalid import documents', async () => {
    const { app } = createHarness({ registrationToken: 'token' });

    const response = await authorized(
      request(app).post('/admin/agents/import').send({ agents: [] }),
    ).expect(400);

    expect(response.body).toMatchObject({
      detail: 'Invalid registry export document',
      issues: expect.any(Array),
    });
  });

  it('imports idempotently by agent id or URL and emits only persisted changes', async () => {
    const { app, context } = createHarness({ allowUnresolvedHostnames: true });
    const agent = registeredAgent('source-id', 'https://source.example/a2a');
    const events: unknown[] = [];
    context.events.on('registry_update', (event) => events.push(event));

    const first = await request(app)
      .post('/admin/agents/import')
      .send(exportDocument([agent]))
      .expect(200);
    expect(first.body).toEqual({ imported: 1, updated: 0, skipped: 0, total: 1 });

    const second = await request(app)
      .post('/admin/agents/import')
      .send(exportDocument([{ ...agent, id: 'changed-id' }]))
      .expect(200);
    expect(second.body).toEqual({ imported: 0, updated: 0, skipped: 1, total: 1 });
    expect(events).toEqual([
      expect.objectContaining({
        type: 'imported',
        agent: expect.objectContaining({ id: 'source-id' }),
      }),
    ]);
  });

  it('skips unsigned imports when the authenticated tenant requires signatures', async () => {
    const { app, context } = createHarness({
      registrationToken: 'token',
      allowUnresolvedHostnames: true,
      tenantTrustPolicies: {
        'tenant-required': { requireSignedAgentCards: true, trustedAgentCardKeys: [] },
      },
    });
    const agent = registeredAgent('unsigned', 'https://unsigned.example/a2a', {
      tenantId: 'tenant-required',
    });

    const response = await authorized(
      request(app)
        .post('/admin/agents/import')
        .send(exportDocument([agent])),
      'tenant-required',
    ).expect(200);

    expect(response.body).toEqual({ imported: 0, updated: 0, skipped: 1, total: 1 });
    expect(await context.store.getAll()).toEqual([]);
  });
});
