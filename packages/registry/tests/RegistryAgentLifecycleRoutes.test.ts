import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  InMemoryRateLimitStore,
  type AgentCard,
} from '@a2amesh/runtime';
import { registerAgentLifecycleRoutes } from '../src/server/agentLifecycleRoutes.js';
import { createRegistryAuth } from '../src/server/auth.js';
import { createRegistryTaskProjection } from '../src/server/taskProjection.js';
import {
  createRegistryServerState,
  type RegistryServerContext,
  type RegistryServerOptions,
} from '../src/server/types.js';
import { InMemoryStorage } from '../src/storage/InMemoryStorage.js';
import type { RegisteredAgent } from '../src/storage/IAgentStorage.js';
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

function registeredAgent(
  id: string,
  options: { tenantId?: string; status?: RegisteredAgent['status'] } = {},
): RegisteredAgent {
  return {
    id,
    url: `https://${id}.example/a2a`,
    card: createAgentCard(id),
    status: options.status ?? 'unknown',
    tags: [],
    skills: [],
    registeredAt: '2026-07-30T12:00:00.000Z',
    ...(options.tenantId ? { tenantId: options.tenantId } : {}),
  };
}

function createHarness(options: RegistryServerOptions = {}) {
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
  const taskProjection = createRegistryTaskProjection(context);
  registerAgentLifecycleRoutes(app, context, auth, taskProjection);
  return { app, context, taskProjection };
}

function authenticated(builder: request.Test, tenantId: string): request.Test {
  return builder
    .set('Authorization', 'Bearer token')
    .set('x-tenant-id', tenantId)
    .set('x-principal-id', `principal-${tenantId}`);
}

describe('registry agent lifecycle routes', () => {
  it('records a healthy heartbeat with metrics, scheduling and registry events', async () => {
    const { app, context } = createHarness({ healthyRecheckIntervalMs: 1_234 });
    await context.store.upsert({
      ...registeredAgent('heartbeat-agent', { status: 'unhealthy' }),
      consecutiveFailures: 3,
    });
    const events: unknown[] = [];
    context.events.on('registry_update', (event) => events.push(event));
    const startedAt = Date.now();

    const response = await request(app).post('/agents/heartbeat-agent/heartbeat').expect(200);

    expect(response.body).toMatchObject({
      id: 'heartbeat-agent',
      status: 'healthy',
      consecutiveFailures: 0,
    });
    expect(response.body.lastHeartbeatAt).toEqual(expect.any(String));
    expect(response.body.lastSuccessAt).toEqual(expect.any(String));
    expect(await context.store.get('heartbeat-agent')).toMatchObject(response.body);
    expect(context.nextHealthCheckAt.get('heartbeat-agent')).toBeGreaterThanOrEqual(
      startedAt + 1_234,
    );
    expect(context.state.metrics.heartbeats).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'heartbeat',
        agent: expect.objectContaining({ id: 'heartbeat-agent', status: 'healthy' }),
      }),
    ]);
  });

  it('enforces tenant access for the admin heartbeat alias', async () => {
    const { app, context } = createHarness({ registrationToken: 'token' });
    await context.store.upsert(registeredAgent('tenant-agent', { tenantId: 'tenant-a' }));

    await authenticated(
      request(app).post('/admin/agents/tenant-agent/heartbeat'),
      'tenant-b',
    ).expect(403);
    await authenticated(
      request(app).post('/admin/agents/tenant-agent/heartbeat'),
      'tenant-a',
    ).expect(200);
    expect(context.state.metrics.heartbeats).toBe(1);
  });

  it('deletes an authorized agent, purges task state and emits the deletion event', async () => {
    const { app, context, taskProjection } = createHarness();
    await context.store.upsert(registeredAgent('delete-agent'));
    context.nextHealthCheckAt.set('delete-agent', 10);
    context.nextTaskPollAt.set('delete-agent', 20);
    const purge = vi.spyOn(taskProjection, 'purgeAgentTaskState');
    const events: unknown[] = [];
    context.events.on('registry_update', (event) => events.push(event));

    await request(app).delete('/agents/delete-agent').expect(204);

    expect(await context.store.get('delete-agent')).toBeNull();
    expect(purge).toHaveBeenCalledWith('delete-agent');
    expect(context.nextHealthCheckAt.has('delete-agent')).toBe(false);
    expect(context.nextTaskPollAt.has('delete-agent')).toBe(false);
    expect(events).toEqual([{ type: 'deleted', id: 'delete-agent' }]);
  });

  it('returns not found without purging state for a missing agent', async () => {
    const { app, taskProjection } = createHarness();
    const purge = vi.spyOn(taskProjection, 'purgeAgentTaskState');

    const response = await request(app).delete('/admin/agents/missing').expect(404);

    expect(response.body).toMatchObject({ detail: 'Agent not found' });
    expect(purge).not.toHaveBeenCalled();
  });
});
