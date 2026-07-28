import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REGISTRY_EXPORT_SCHEMA_ID,
  RegistryExportDocumentSchema,
  type AgentCard,
  type Task,
} from '@a2amesh/runtime';
import { RegistryServer } from '../src/RegistryServer.js';

function createAgentCard(name: string, url = 'http://localhost:0'): AgentCard {
  return {
    protocolVersion: '1.0',
    name,
    description: `${name} description`,
    version: '1.0.0',
    url,
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
        description: 'Searches, analyzes and summarizes information',
        tags: ['research', 'analysis'],
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

function createTask(
  id: string,
  status: Task['status']['state'],
  timestamp: string,
  summary: string,
): Task {
  return {
    id,
    status: {
      state: status,
      timestamp,
    },
    history: [
      {
        role: 'user',
        messageId: `message-${id}`,
        timestamp,
        parts: [{ type: 'text', text: `history ${id}` }],
      },
    ],
    artifacts: [
      {
        artifactId: `artifact-${id}`,
        index: 0,
        lastChunk: true,
        parts: [{ type: 'text', text: summary }],
      },
    ],
  };
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

describe('RegistryServer control plane endpoints', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a sanitized anonymous operator context with the configured freshness budget', async () => {
    const server = new RegistryServer({
      healthyRecheckIntervalMs: 15_000,
      unhealthyRecheckIntervalMs: 20_000,
      unknownRecheckIntervalMs: 30_000,
    });

    const response = await request(server.getExpressApp()).get('/context');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accessMode: 'authenticated',
      authMethod: 'anonymous',
      tenantId: null,
      visibilityScope: 'all',
      healthStaleAfterMs: 60_000,
    });
  });

  it('reports tenant-scoped bearer context and a public-only readonly context', async () => {
    const registrationToken = 'control-token';
    const server = new RegistryServer({ registrationToken });
    const app = server.getExpressApp();

    await request(app).get('/context').expect(401);

    const operator = await request(app)
      .get('/context')
      .set('Authorization', `Bearer ${registrationToken}`)
      .set('x-tenant-id', 'tenant-a');

    expect(operator.status).toBe(200);
    expect(operator.body).toEqual({
      accessMode: 'authenticated',
      authMethod: 'bearer',
      tenantId: 'tenant-a',
      visibilityScope: 'tenant-and-public',
      healthStaleAfterMs: 240_000,
    });

    const unscopedOperator = await request(app)
      .get('/context')
      .set('Authorization', `Bearer ${registrationToken}`);
    expect(unscopedOperator.status).toBe(200);
    expect(unscopedOperator.body).toEqual({
      accessMode: 'authenticated',
      authMethod: 'bearer',
      tenantId: null,
      visibilityScope: 'public-and-unassigned',
      healthStaleAfterMs: 240_000,
    });

    const readonly = await request(app).get('/context').query({ public: 'true' });
    expect(readonly.status).toBe(200);
    expect(readonly.body).toEqual({
      accessMode: 'readonly-public',
      authMethod: 'anonymous',
      tenantId: null,
      visibilityScope: 'public-only',
      healthStaleAfterMs: 240_000,
    });
  });

  it('exports an empty registry as a versioned document that matches the public schema', async () => {
    const server = new RegistryServer({ registrationToken: 'control-token' });

    const response = await request(server.getExpressApp())
      .get('/admin/agents/export')
      .set('Authorization', 'Bearer control-token');

    expect(response.status).toBe(200);
    const document = RegistryExportDocumentSchema.parse(response.body);
    expect(document).toMatchObject({
      $schema: REGISTRY_EXPORT_SCHEMA_ID,
      schemaVersion: '1',
      agents: [],
      metadata: {
        source: 'a2amesh-registry',
        agentCount: 0,
        tenants: [],
        publicAgents: 0,
      },
    });
  });

  it('exports tenant-scoped private agents with public agents from other tenants', async () => {
    const server = new RegistryServer({
      allowUnresolvedHostnames: true,
      registrationToken: 'control-token',
    });
    const app = server.getExpressApp();

    await request(app)
      .post('/admin/agents/register')
      .set('Authorization', 'Bearer control-token')
      .set('x-tenant-id', 'tenant-a')
      .send({
        agentUrl: 'https://tenant-a.example.com/a2a',
        agentCard: createAgentCard('Tenant A Agent', 'https://tenant-a.example.com/a2a'),
      })
      .expect(201);
    await request(app)
      .post('/admin/agents/register')
      .set('Authorization', 'Bearer control-token')
      .set('x-tenant-id', 'tenant-b')
      .send({
        agentUrl: 'https://tenant-b.example.com/a2a',
        agentCard: createAgentCard('Tenant B Agent', 'https://tenant-b.example.com/a2a'),
      })
      .expect(201);
    await request(app)
      .post('/admin/agents/register')
      .set('Authorization', 'Bearer control-token')
      .set('x-tenant-id', 'tenant-b')
      .send({
        agentUrl: 'https://public.example.com/a2a',
        agentCard: createAgentCard('Public Agent', 'https://public.example.com/a2a'),
        isPublic: true,
      })
      .expect(201);

    const response = await request(app)
      .get('/admin/agents/export')
      .set('Authorization', 'Bearer control-token')
      .set('x-tenant-id', 'tenant-a');

    expect(response.status).toBe(200);
    const document = RegistryExportDocumentSchema.parse(response.body);
    expect(document.agents.map((agent) => agent.url).sort()).toEqual([
      'https://public.example.com/a2a',
      'https://tenant-a.example.com/a2a',
    ]);
    expect(document.metadata['agentCount']).toBe(2);
    expect(document.metadata['tenants']).toEqual(['tenant-a', 'tenant-b']);
    expect(document.metadata['publicAgents']).toBe(1);
  });

  it('imports registry documents idempotently by unchanged agent ids or urls', async () => {
    const source = new RegistryServer({ allowUnresolvedHostnames: true });
    const target = new RegistryServer({ allowUnresolvedHostnames: true });

    await request(source.getExpressApp())
      .post('/admin/agents/register')
      .send({
        agentUrl: 'https://alpha.example.com/a2a',
        agentCard: createAgentCard('Alpha Agent', 'https://alpha.example.com/a2a'),
      })
      .expect(201);
    await request(source.getExpressApp())
      .post('/admin/agents/register')
      .send({
        agentUrl: 'https://beta.example.com/a2a',
        agentCard: createAgentCard('Beta Agent', 'https://beta.example.com/a2a'),
        tenantId: 'tenant-beta',
        isPublic: true,
      })
      .expect(201);

    const exportResponse = await request(source.getExpressApp())
      .get('/admin/agents/export')
      .expect(200);
    const document = RegistryExportDocumentSchema.parse(exportResponse.body);

    const firstImport = await request(target.getExpressApp())
      .post('/admin/agents/import')
      .send(document)
      .expect(200);
    expect(firstImport.body).toEqual({ imported: 2, updated: 0, skipped: 0, total: 2 });

    const secondImport = await request(target.getExpressApp())
      .post('/admin/agents/import')
      .send(document)
      .expect(200);
    expect(secondImport.body).toEqual({ imported: 0, updated: 0, skipped: 2, total: 2 });

    const urlOnlyDocument = {
      ...document,
      agents: document.agents.map((agent, index) => ({
        ...agent,
        id: `changed-id-${index}`,
      })),
    };
    const urlImport = await request(target.getExpressApp())
      .post('/admin/agents/import')
      .send(urlOnlyDocument)
      .expect(200);
    expect(urlImport.body).toEqual({ imported: 0, updated: 0, skipped: 2, total: 2 });

    const listed = await request(target.getExpressApp()).get('/agents').expect(200);
    expect(listed.body).toHaveLength(2);
  });

  it('requires control-plane authorization for export and import when registry auth is enabled', async () => {
    const server = new RegistryServer({ registrationToken: 'control-token' });
    const document = {
      $schema: REGISTRY_EXPORT_SCHEMA_ID,
      schemaVersion: '1',
      exportedAt: '2026-05-25T12:00:00.000Z',
      agents: [],
      metadata: {
        source: 'a2amesh-registry',
        agentCount: 0,
        tenants: [],
        publicAgents: 0,
      },
    };

    await request(server.getExpressApp()).get('/admin/agents/export').expect(401);
    await request(server.getExpressApp()).post('/admin/agents/import').send(document).expect(401);
  });

  it('returns metrics summary with registration, search, heartbeat and tenant counts', async () => {
    const server = new RegistryServer({ allowLocalhost: true });

    const registerResponse = await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'http://localhost:3001',
        agentCard: createAgentCard('Metrics Agent'),
        tenantId: 'tenant-metrics',
        isPublic: true,
      });

    expect(registerResponse.status).toBe(201);

    const agentId = registerResponse.body.id as string;
    await request(server.getExpressApp())
      .get('/agents/search')
      .query({ name: 'metrics' })
      .expect(200);
    await request(server.getExpressApp()).post(`/agents/${agentId}/heartbeat`).expect(200);

    const response = await request(server.getExpressApp()).get('/metrics/summary');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      registrations: 1,
      searches: 1,
      heartbeats: 1,
      agentCount: 1,
      healthyAgents: 1,
      unhealthyAgents: 0,
      unknownAgents: 0,
      activeTenants: 1,
      publicAgents: 1,
    });
  });

  it('aggregates recent tasks across registered agents for the control plane', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = toUrl(input);

      if (url === 'http://localhost:3001/tasks?limit=20') {
        return new Response(
          JSON.stringify([
            createTask(
              'task-researcher',
              'WORKING',
              '2026-04-06T10:00:00.000Z',
              'Researcher is collecting source material.',
            ),
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url === 'http://localhost:3002/tasks?limit=20') {
        return new Response(
          JSON.stringify([
            createTask(
              'task-writer',
              'COMPLETED',
              '2026-04-06T10:05:00.000Z',
              'Writer produced a polished final report.',
            ),
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const server = new RegistryServer({
      allowLocalhost: true,
      taskPollingIntervalMs: 60_000,
      maxRecentTasks: 10,
    });

    await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'http://localhost:3001',
        agentCard: createAgentCard('Researcher Agent'),
      });
    await request(server.getExpressApp())
      .post('/agents/register')
      .send({
        agentUrl: 'http://localhost:3002',
        agentCard: createAgentCard('Writer Agent'),
      });

    const response = await request(server.getExpressApp()).get('/tasks/recent').query({ limit: 2 });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      taskId: 'task-writer',
      agentName: 'Writer Agent',
      agentUrl: 'http://localhost:3002',
      status: 'COMPLETED',
      updatedAt: '2026-04-06T10:05:00.000Z',
      summary: 'Writer produced a polished final report.',
      historyCount: 1,
      artifactCount: 1,
    });
    expect(response.body[1]).toMatchObject({
      taskId: 'task-researcher',
      agentName: 'Researcher Agent',
      agentUrl: 'http://localhost:3001',
      status: 'WORKING',
      updatedAt: '2026-04-06T10:00:00.000Z',
      summary: 'Researcher is collecting source material.',
      historyCount: 1,
      artifactCount: 1,
    });

    const limited = await request(server.getExpressApp()).get('/tasks/recent').query({ limit: 1 });
    expect(limited.status).toBe(200);
    expect(limited.body).toHaveLength(1);
    expect(limited.body[0].taskId).toBe('task-writer');
  });
});
