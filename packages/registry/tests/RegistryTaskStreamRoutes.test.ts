import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  InMemoryRateLimitStore,
  type AgentCard,
  type Task,
} from '@a2amesh/runtime';
import { createRegistryAuth } from '../src/server/auth.js';
import { registerRegistryTaskStreamRoutes } from '../src/server/registryTaskStreamRoutes.js';
import { createRegistrySse } from '../src/server/sse.js';
import { createRegistryTaskProjection } from '../src/server/taskProjection.js';
import {
  createRegistryServerState,
  type RegistryServerContext,
  type RegistryTaskEvent,
} from '../src/server/types.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';
import { InMemoryTrustLogStorage } from '../src/storage/InMemoryTrustLogStorage.js';

function createAgent(id: string): RegisteredAgent {
  const card: AgentCard = {
    protocolVersion: '1.0',
    name: `Agent ${id}`,
    description: `Agent ${id} description`,
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
    status: 'healthy',
    tags: [],
    skills: [],
    registeredAt: '2026-07-31T00:00:00.000Z',
  };
}

function createTask(id: string, updatedAt: string): Task {
  return {
    id,
    status: { state: 'WORKING', timestamp: updatedAt },
    history: [],
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
  const sse = createRegistrySse(context);
  const taskProjection = createRegistryTaskProjection(context);
  const refreshTaskSnapshots = vi.fn(async () => undefined);
  registerRegistryTaskStreamRoutes(
    app,
    context,
    auth,
    { refreshTaskSnapshots },
    sse,
    taskProjection,
  );

  return { app, context, refreshTaskSnapshots, taskProjection };
}

async function listen(app: Express): Promise<Server> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function beginStream(app: Express, path: string, headers: Record<string, string> = {}) {
  const server = await listen(app);
  const port = (server.address() as { port: number }).port;
  const controller = new AbortController();
  const responsePromise = fetch(`http://localhost:${port}${path}`, {
    headers,
    signal: controller.signal,
  });
  return { server, controller, responsePromise };
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
): Promise<string> {
  expect(reader).toBeDefined();
  const chunk = await reader?.read();
  return new TextDecoder().decode(chunk?.value);
}

describe('registry task and stream routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes empty recent-task state and applies explicit and default limits', async () => {
    const { app, context, refreshTaskSnapshots } = createHarness({ maxRecentTasks: 2 });
    refreshTaskSnapshots.mockImplementation(async () => {
      const events: RegistryTaskEvent[] = [
        {
          taskId: 'newest',
          agentId: 'agent-a',
          agentName: 'Agent A',
          agentUrl: 'https://agent-a.example/a2a',
          status: 'WORKING',
          updatedAt: '2026-07-31T00:02:00.000Z',
          historyCount: 0,
          artifactCount: 0,
          task: createTask('newest', '2026-07-31T00:02:00.000Z'),
        },
        {
          taskId: 'older',
          agentId: 'agent-b',
          agentName: 'Agent B',
          agentUrl: 'https://agent-b.example/a2a',
          status: 'WORKING',
          updatedAt: '2026-07-31T00:01:00.000Z',
          historyCount: 0,
          artifactCount: 0,
          task: createTask('older', '2026-07-31T00:01:00.000Z'),
        },
      ];
      for (const event of events) {
        context.recentTasks.set(`${event.agentId}:${event.taskId}`, event);
      }
    });

    const limited = await request(app).get('/tasks/recent').query({ limit: 1 }).expect(200);
    expect(limited.body.map((event: RegistryTaskEvent) => event.taskId)).toEqual(['newest']);
    expect(refreshTaskSnapshots).toHaveBeenCalledTimes(1);

    const defaulted = await request(app)
      .get('/tasks/recent')
      .query({ limit: 'invalid' })
      .expect(200);
    expect(defaulted.body.map((event: RegistryTaskEvent) => event.taskId)).toEqual([
      'newest',
      'older',
    ]);
    expect(refreshTaskSnapshots).toHaveBeenCalledTimes(1);
  });

  it('streams named registry events and unregisters the listener on close', async () => {
    const { app, context } = createHarness();
    const stream = await beginStream(app, '/events');
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      await vi.waitFor(() => expect(context.events.listenerCount('registry_update')).toBe(1));
      context.events.emit('registry_update', { type: 'registered', agent: createAgent('stream') });
      const response = await stream.responsePromise;
      reader = response.body?.getReader();
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const chunk = await readChunk(reader);
      expect(chunk).toContain('event: registry_update');
      expect(chunk).toContain('"type":"registered"');
    } finally {
      await reader?.cancel();
      stream.controller.abort();
      await close(stream.server);
    }

    await vi.waitFor(() => expect(context.events.listenerCount('registry_update')).toBe(0));
  });

  it('normalizes agent stream events and ignores unsupported registry updates', async () => {
    const { app, context } = createHarness();
    const stream = await beginStream(app, '/agents/stream');
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      await vi.waitFor(() => expect(context.events.listenerCount('registry_update')).toBe(1));
      context.events.emit('registry_update', { type: 'ignored' });
      context.events.emit('registry_update', { type: 'deleted', id: 'agent-deleted' });
      const response = await stream.responsePromise;
      reader = response.body?.getReader();
      const chunk = await readChunk(reader);
      expect(chunk).toContain('"id":"agent-deleted"');
      expect(chunk).toContain('"deleted":true');
      expect(chunk).not.toContain('ignored');
    } finally {
      await reader?.cancel();
      stream.controller.abort();
      await close(stream.server);
    }
  });

  it('streams cached task snapshots before live task updates', async () => {
    const { app, context, taskProjection } = createHarness();
    const agent = createAgent('task-agent');
    const cached = taskProjection.recordTask(
      agent,
      createTask('cached-task', '2026-07-31T00:03:00.000Z'),
    );
    expect(cached).not.toBeNull();

    const stream = await beginStream(app, '/tasks/stream');
    const response = await stream.responsePromise;
    const reader = response.body?.getReader();
    try {
      const cachedChunk = await readChunk(reader);
      expect(cachedChunk).toContain('"taskId":"cached-task"');

      const live = taskProjection.toTaskEvent(
        agent,
        createTask('live-task', '2026-07-31T00:04:00.000Z'),
      );
      context.taskEvents.emit('task_updated', live);
      const liveChunk = await readChunk(reader);
      expect(liveChunk).toContain('"taskId":"live-task"');
    } finally {
      await reader?.cancel();
      stream.controller.abort();
      await close(stream.server);
    }
  });
});
