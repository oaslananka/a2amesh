import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  InMemoryRateLimitStore,
  signAgentCard,
  type AgentCard,
  type SigningKey,
  type Task,
  type VerificationKey,
} from '@a2amesh/runtime';
import { registerRegistryRoutes } from '../src/server/routes.js';
import { createRegistryAuth } from '../src/server/auth.js';
import { createRegistryMetrics } from '../src/server/metrics.js';
import { createRegistryPolling } from '../src/server/polling.js';
import { createRegistrySse } from '../src/server/sse.js';
import {
  createRegistryServerState,
  type RegistryServerContext,
  type RegistryServerOptions,
} from '../src/server/types.js';
import { createRegistryTaskProjection } from '../src/server/taskProjection.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';

function createEs256KeyPair(keyId = 'registry-agent-key') {
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

function createAgentCard(name: string): AgentCard {
  return {
    protocolVersion: '1.0',
    name,
    description: `${name} description`,
    url: 'http://localhost:0',
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
        description: 'Searches and summarizes information',
        tags: ['research'],
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

function createTask(id: string, timestamp: string, summary = `summary ${id}`): Task {
  return {
    id,
    status: {
      state: 'WORKING',
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

function createRegisteredAgent(id: string, name: string, url = `http://localhost:${id}`) {
  return {
    id,
    url,
    card: createAgentCard(name),
    status: 'unknown',
    tags: ['research'],
    skills: ['Research'],
    registeredAt: '2026-04-06T10:00:00.000Z',
  } satisfies RegisteredAgent;
}

function createRouteHarness(options: RegistryServerOptions = {}) {
  const app = express();
  const context: RegistryServerContext = {
    store: options.storage ?? new InMemoryStorage(),
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
  const taskProjection = createRegistryTaskProjection(context);
  const sse = createRegistrySse(context);
  const metrics = createRegistryMetrics(context);
  const polling = createRegistryPolling(context, taskProjection);

  registerRegistryRoutes(app, context, {
    auth,
    metrics,
    polling,
    sse,
    taskProjection,
  });

  return { app, context, polling, sse, taskProjection };
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

async function listen(app: Express): Promise<Server> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('RegistryServer control-plane modules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers, lists and deletes agents through the route module', async () => {
    const { app } = createRouteHarness({
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });

    const registered = await request(app)
      .post('/agents/register')
      .send({
        agentUrl: 'http://localhost:3001',
        agentCard: createAgentCard('Route Agent'),
      })
      .expect(201);

    expect(registered.body).toMatchObject({
      url: 'http://localhost:3001',
      status: 'unknown',
      tags: ['research'],
      skills: ['Research'],
    });

    const listed = await request(app).get('/agents').expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(registered.body.id);

    await request(app).delete(`/agents/${registered.body.id}`).expect(204);

    const afterDelete = await request(app).get('/agents').expect(200);
    expect(afterDelete.body).toEqual([]);
  });

  it('renders metrics routes from the metrics module', async () => {
    const { app } = createRouteHarness({
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });

    const registered = await request(app)
      .post('/agents/register')
      .send({
        agentUrl: 'http://localhost:3002',
        tenantId: 'tenant-metrics',
        isPublic: true,
        agentCard: createAgentCard('Metrics Route Agent'),
      })
      .expect(201);

    await request(app).get('/agents/search').query({ name: 'metrics' }).expect(200);
    await request(app).post(`/agents/${registered.body.id}/heartbeat`).expect(200);

    const prometheus = await request(app).get('/metrics').expect(200);
    expect(prometheus.headers['content-type']).toContain('text/plain');
    expect(prometheus.text).toContain('a2a_registry_registrations_total 1');
    expect(prometheus.text).toContain('a2a_registry_searches_total 1');
    expect(prometheus.text).toContain('a2a_registry_heartbeats_total 1');
    expect(prometheus.text).toContain('a2a_registry_active_tenants 1');

    const summary = await request(app).get('/metrics/summary').expect(200);
    expect(summary.body).toMatchObject({
      registrations: 1,
      searches: 1,
      heartbeats: 1,
      agentCount: 1,
      healthyAgents: 1,
      activeTenants: 1,
      publicAgents: 1,
    });
  });

  it('streams cached task events through the route and SSE modules', async () => {
    const { app, context, taskProjection } = createRouteHarness({
      allowLocalhost: true,
      maxRecentTasks: 5,
    });
    const agent = createRegisteredAgent('3003', 'Streaming Route Agent');
    const taskEvent = taskProjection.recordTask(
      agent,
      createTask('stream-task', '2026-04-06T10:03:00.000Z'),
    );
    expect(taskEvent).not.toBeNull();

    const server = await listen(app);
    const port = (server.address() as { port: number }).port;
    const controller = new AbortController();

    try {
      const response = await fetch(`http://localhost:${port}/tasks/stream`, {
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(context.sseClients.size).toBe(1);

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const firstChunk = await reader?.read();
      const payload = new TextDecoder().decode(firstChunk?.value);
      expect(payload).toContain('data:');
      expect(payload).toContain('"taskId":"stream-task"');

      await reader?.cancel();
      controller.abort();
    } finally {
      await close(server);
    }
  });

  it('polls due agents, projects task events and deduplicates unchanged task versions', async () => {
    const { context, polling } = createRouteHarness({
      allowLocalhost: true,
      taskPollingBatchSize: 10,
    });
    const agent = createRegisteredAgent('3004', 'Polling Agent');
    await context.store.upsert(agent);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = toUrl(input);
      if (url === 'http://localhost:3004/tasks?limit=20') {
        return new Response(JSON.stringify([createTask('poll-task', '2026-04-06T10:04:00.000Z')]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const taskEvents: unknown[] = [];
    context.taskEvents.on('task_updated', (event) => taskEvents.push(event));

    await polling.refreshTaskSnapshots();
    await polling.pollAgentTasks(agent);

    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]).toMatchObject({
      taskId: 'poll-task',
      agentId: '3004',
      agentName: 'Polling Agent',
      summary: 'summary poll-task',
    });
    expect(context.recentTasks.get('3004:poll-task')).toMatchObject({
      taskId: 'poll-task',
    });
  });

  it('ignores malformed task polling responses without emitting task events', async () => {
    const { context, polling } = createRouteHarness({
      allowLocalhost: true,
      taskPollingBatchSize: 10,
    });
    const agent = createRegisteredAgent('3006', 'Malformed Polling Agent');
    await context.store.upsert(agent);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = toUrl(input);
      if (url === 'http://localhost:3006/tasks?limit=20') {
        return new Response(
          JSON.stringify([
            { id: 'missing-status', history: [] },
            createTask('valid-task', '2026-04-06T10:06:00.000Z'),
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const taskEvents: unknown[] = [];
    context.taskEvents.on('task_updated', (event) => taskEvents.push(event));

    await polling.pollAgentTasks(agent);

    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]).toMatchObject({ taskId: 'valid-task' });
    expect(context.recentTasks.has('3006:missing-status')).toBe(false);
    expect(context.nextTaskPollAt.get(agent.id)).toBeGreaterThan(Date.now());
  });

  it('schedules the next task poll for non-array task responses', async () => {
    const { context, polling } = createRouteHarness({
      allowLocalhost: true,
      taskPollingBatchSize: 10,
    });
    const agent = createRegisteredAgent('3007', 'Non Array Polling Agent');
    await context.store.upsert(agent);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = toUrl(input);
      if (url === 'http://localhost:3007/tasks?limit=20') {
        return new Response(JSON.stringify({ tasks: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const taskEvents: unknown[] = [];
    context.taskEvents.on('task_updated', (event) => taskEvents.push(event));

    await polling.pollAgentTasks(agent);

    expect(taskEvents).toEqual([]);
    expect(context.nextTaskPollAt.get(agent.id)).toBeGreaterThan(Date.now());
  });

  it('normalizes registry update events through the SSE module', () => {
    const { sse } = createRouteHarness();
    const agent = createRegisteredAgent('3005', 'SSE Agent');

    expect(sse.normalizeAgentStreamPayload({ type: 'registered', agent })).toBe(agent);
    expect(sse.normalizeAgentStreamPayload({ type: 'heartbeat', agent })).toBe(agent);
    expect(sse.normalizeAgentStreamPayload({ type: 'deleted', id: '3005' })).toEqual({
      id: '3005',
      deleted: true,
    });
    expect(sse.normalizeAgentStreamPayload({ type: 'ignored' })).toBeNull();
  });

  it('escapes HTML-sensitive characters while preserving JSON payloads for SSE', () => {
    const { sse } = createRouteHarness();
    const payload = {
      text: '</script><img src=x onerror=alert(1)>&',
    };

    const serialized = sse.serializeData(payload);

    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).not.toContain('&');
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});

describe('Registry distributed polling lease scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not list agents for scheduled task polling when no lease store is available', async () => {
    vi.useFakeTimers();
    const { polling, context } = createRouteHarness({
      distributedPollingLeases: true,
      taskPollingIntervalMs: 100,
    });
    const listSpy = vi.spyOn(context.store, 'list');

    polling.startTaskPolling();
    await vi.advanceTimersByTimeAsync(100);
    polling.stop();

    expect(listSpy).not.toHaveBeenCalled();
  });

  it('lists agents and releases ownership for scheduled task polling when the lease is acquired', async () => {
    vi.useFakeTimers();
    class LeaseGrantedStorage extends InMemoryStorage {
      acquireCalls = 0;
      releaseCalls = 0;
      listCalls = 0;
      async acquirePollingLease(): Promise<boolean> {
        this.acquireCalls += 1;
        return true;
      }
      async releasePollingLease(): Promise<void> {
        this.releaseCalls += 1;
      }
      override async list(...args: Parameters<InMemoryStorage['list']>) {
        this.listCalls += 1;
        return super.list(...args);
      }
    }

    const store = new LeaseGrantedStorage();
    const { polling } = createRouteHarness({
      storage: store,
      distributedPollingLeases: true,
      taskPollingIntervalMs: 100,
    });

    polling.startTaskPolling();
    await vi.advanceTimersByTimeAsync(100);
    polling.stop();

    expect(store.acquireCalls).toBeGreaterThan(0);
    expect(store.listCalls).toBeGreaterThan(0);
    expect(store.releaseCalls).toBeGreaterThan(0);
  });

  it('skips malformed task payloads with unsafe history entries during polling', async () => {
    const agent = createRegisteredAgent('malformed-task-agent', 'Malformed Task Agent');
    const { polling, context } = createRouteHarness({ allowLocalhost: true });
    const server = await listen(
      express().get('/tasks', (_req, res) => {
        res.json([
          {
            id: 'bad-history-task',
            status: { state: 'WORKING', timestamp: '2026-04-06T10:00:00.000Z' },
            history: [{ role: 'user', parts: [{ type: 'text', text: 42 }] }],
          },
        ]);
      }),
    );

    try {
      const port = (server.address() as { port: number }).port;
      await polling.pollAgentTasks({ ...agent, url: `http://localhost:${port}` });
      expect(context.recentTasks.size).toBe(0);
    } finally {
      await close(server);
    }
  });
});

describe('Registry tenant trust and signed Agent Card handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores trusted verification metadata for tenant-scoped signed Agent Cards', async () => {
    const { signingKey, verificationKey } = createEs256KeyPair('tenant-a-key');
    const signedCard = await signAgentCard(createAgentCard('Signed Tenant Agent'), signingKey);
    const { app } = createRouteHarness({
      allowLocalhost: true,
      registrationToken: 'token',
      requireSignedAgentCards: true,
      trustedAgentCardKeys: [verificationKey],
    });

    const registered = await request(app)
      .post('/agents/register')
      .set('Authorization', 'Bearer token')
      .set('x-tenant-id', 'tenant-a')
      .send({
        agentUrl: 'http://localhost:3030',
        agentCard: signedCard,
      })
      .expect(201);

    expect(registered.body).toMatchObject({
      tenantId: 'tenant-a',
      verification: {
        required: true,
        valid: true,
        state: 'trusted',
        keyId: 'tenant-a-key',
        tenantId: 'tenant-a',
      },
    });
    expect(registered.body.verification.verifiedAt).toEqual(expect.any(String));
  });

  it('rejects unsigned Agent Cards when tenant trust requires signatures', async () => {
    const { app } = createRouteHarness({
      allowLocalhost: true,
      registrationToken: 'token',
      tenantTrustPolicies: {
        'tenant-secure': {
          requireSignedAgentCards: true,
          trustedAgentCardKeys: [],
        },
      },
    });

    const response = await request(app)
      .post('/agents/register')
      .set('Authorization', 'Bearer token')
      .set('x-tenant-id', 'tenant-secure')
      .send({
        agentUrl: 'http://localhost:3031',
        agentCard: createAgentCard('Unsigned Tenant Agent'),
      })
      .expect(403);

    expect(response.body.detail).toContain('signature is required');
  });

  it('blocks public registration when the tenant trust lifecycle disallows it', async () => {
    const { app } = createRouteHarness({
      allowLocalhost: true,
      registrationToken: 'token',
      tenantTrustPolicies: {
        'tenant-private': {
          allowPublicAgents: false,
        },
      },
    });

    await request(app)
      .post('/agents/register')
      .set('Authorization', 'Bearer token')
      .set('x-tenant-id', 'tenant-private')
      .send({
        agentUrl: 'http://localhost:3032',
        agentCard: createAgentCard('Public Denied Agent'),
        isPublic: true,
      })
      .expect(403);
  });

  it('skips imported Agent Cards that fail required tenant verification', async () => {
    const { app } = createRouteHarness({
      allowLocalhost: true,
      registrationToken: 'token',
      tenantTrustPolicies: {
        'tenant-import': {
          requireSignedAgentCards: true,
          trustedAgentCardKeys: [],
        },
      },
    });

    const imported = await request(app)
      .post('/admin/agents/import')
      .set('Authorization', 'Bearer token')
      .set('x-tenant-id', 'tenant-import')
      .send({
        $schema: 'https://oaslananka.github.io/a2amesh/schemas/registry-export.schema.json',
        schemaVersion: '1',
        exportedAt: '2026-04-06T10:00:00.000Z',
        agents: [
          {
            id: 'import-unsigned',
            url: 'http://localhost:3033',
            card: createAgentCard('Import Unsigned Agent'),
            status: 'unknown',
            tags: ['research'],
            skills: ['Research'],
            registeredAt: '2026-04-06T10:00:00.000Z',
            tenantId: 'tenant-import',
          },
        ],
        metadata: {
          source: 'a2amesh-registry',
          agentCount: 1,
          tenants: ['tenant-import'],
          publicAgents: 0,
        },
      })
      .expect(200);

    expect(imported.body).toMatchObject({ imported: 0, updated: 0, skipped: 1, total: 1 });
    const listed = await request(app)
      .get('/agents')
      .set('Authorization', 'Bearer token')
      .set('x-tenant-id', 'tenant-import')
      .expect(200);
    expect(listed.body).toEqual([]);
  });
});
