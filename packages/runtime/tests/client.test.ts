import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2AClient } from '../src/client/A2AClient.js';
import { AgentRegistryClient } from '../src/client/AgentRegistryClient.js';
import { createAuthenticatingFetchWithRetry } from '../src/client/interceptors.js';
import { REGISTRY_EXPORT_SCHEMA_ID, type RegistryExportDocument } from '../src/schemas/public.js';

describe('A2AClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes official protocol versions separately from experimental profiles', () => {
    expect(A2AClient.supportedVersions).toEqual(['1.0']);
    expect(A2AClient.experimentalProtocolVersions).toEqual(['1.2']);
  });

  it('falls back to legacy agent.json when canonical card is unavailable', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            protocolVersion: '1.0',
            name: 'Legacy',
            description: 'desc',
            url: 'http://test',
            version: '1.0',
          }),
          { status: 200 },
        ),
      );

    const client = new A2AClient('http://localhost:3000');
    const card = await client.resolveCard();
    expect(card.name).toBe('Legacy');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('connects using the official structured interface by default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: '1.0',
          name: 'Negotiated',
          description: 'desc',
          url: 'http://legacy.example/a2a',
          version: '1.0',
          supportedInterfaces: [
            {
              url: 'https://grpc.example/a2a',
              protocolBinding: 'gRPC',
              protocolVersion: '1.2',
            },
            {
              url: 'https://official.example/a2a',
              protocolBinding: 'HTTP+JSON',
              protocolVersion: '1.0',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const client = await A2AClient.connect('https://cards.example/.well-known/agent-card.json');

    expect(client.baseUrl).toBe('https://official.example/a2a');
    expect(fetchSpy).toHaveBeenCalledWith('https://cards.example/.well-known/agent-card.json', {
      headers: { 'A2A-Version': '1.0' },
    });
  });

  it('connects using an experimental protocol profile only when explicitly enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: '1.0',
          name: 'Negotiated',
          description: 'desc',
          url: 'http://legacy.example/a2a',
          version: '1.0',
          supportedInterfaces: [
            {
              url: 'https://experimental.example/a2a',
              protocolBinding: 'HTTP+JSON',
              protocolVersion: '1.2',
            },
            {
              url: 'https://official.example/a2a',
              protocolBinding: 'HTTP+JSON',
              protocolVersion: '1.0',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const client = await A2AClient.connect('https://cards.example/.well-known/agent-card.json', {
      allowExperimentalProtocolVersions: true,
      preferredProtocolVersion: '1.2',
    });

    expect(client.baseUrl).toBe('https://experimental.example/a2a');
  });

  it('rejects preferred experimental protocol profiles unless enabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: '1.0',
          name: 'Negotiated',
          description: 'desc',
          url: 'http://legacy.example/a2a',
          version: '1.0',
          supportedInterfaces: [
            {
              url: 'https://experimental.example/a2a',
              protocolBinding: 'HTTP+JSON',
              protocolVersion: '1.2',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      A2AClient.connect('https://cards.example/.well-known/agent-card.json', {
        preferredProtocolVersion: '1.2',
      }),
    ).rejects.toThrow('Set allowExperimentalProtocolVersions to true');
  });

  it('throws JSON-RPC errors returned by the server', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32004, message: 'Task not found' },
          id: '1',
        }),
        { status: 200 },
      ),
    );

    const client = new A2AClient('http://localhost:3000');
    await expect(client.getTask('missing')).rejects.toThrow('Task not found');
  });

  it('calls official push notification config CRUD RPC methods', async () => {
    const bodies: Array<{ method: string; params: Record<string, unknown> }> = [];
    const results = [
      { id: 'sms', url: 'https://example.com/sms' },
      { id: 'sms', url: 'https://example.com/sms' },
      { configs: [{ id: 'sms', url: 'https://example.com/sms' }] },
      { deleted: true },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      bodies.push({ method: body.method, params: body.params });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: results.shift(),
        }),
        { status: 200 },
      );
    });

    const client = new A2AClient('http://localhost:3000');

    await expect(
      client.createPushNotificationConfig('task-1', {
        id: 'sms',
        url: 'https://example.com/sms',
      }),
    ).resolves.toEqual({ id: 'sms', url: 'https://example.com/sms' });
    await expect(client.getPushNotificationConfig('task-1', 'sms')).resolves.toEqual({
      id: 'sms',
      url: 'https://example.com/sms',
    });
    await expect(client.listPushNotificationConfigs('task-1')).resolves.toEqual({
      configs: [{ id: 'sms', url: 'https://example.com/sms' }],
    });
    await expect(client.deletePushNotificationConfig('task-1', 'sms')).resolves.toEqual({
      deleted: true,
    });

    expect(bodies).toEqual([
      {
        method: 'tasks/pushNotificationConfig/create',
        params: {
          taskId: 'task-1',
          configId: 'sms',
          pushNotificationConfig: { id: 'sms', url: 'https://example.com/sms' },
        },
      },
      {
        method: 'tasks/pushNotificationConfig/get',
        params: { taskId: 'task-1', configId: 'sms' },
      },
      {
        method: 'tasks/pushNotificationConfig/list',
        params: { taskId: 'task-1' },
      },
      {
        method: 'tasks/pushNotificationConfig/delete',
        params: { taskId: 'task-1', configId: 'sms' },
      },
    ]);
  });

  it('sends RPC requests with interceptors and merged headers', async () => {
    const before = vi.fn(async ({ options }) => {
      options.headers = { ...(options.headers ?? {}), authorization: 'Bearer token' };
      options.serviceParameters = { 'x-service-mode': 'fast' };
    });
    const after = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          result: {
            id: 'task-1',
            status: { state: 'SUBMITTED', timestamp: new Date().toISOString() },
            history: [],
          },
          id: '1',
        }),
        { status: 200 },
      ),
    );

    const client = new A2AClient('http://localhost:3000', {
      headers: { 'x-client-id': 'cli-1' },
      interceptors: [{ before, after }],
    });

    const task = await client.sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      messageId: 'message-1',
      timestamp: new Date().toISOString(),
    });

    expect(task.id).toBe('task-1');
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'x-client-id': 'cli-1',
        authorization: 'Bearer token',
        'x-service-mode': 'fast',
      }),
    });
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'message/send',
        response: expect.objectContaining({ id: 'task-1' }),
      }),
    );
  });

  it('throws when both agent card endpoints fail', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const client = new A2AClient('http://localhost:3000');
    await expect(client.resolveCard()).rejects.toThrow('Failed to resolve agent card');
  });

  it('throws when the RPC endpoint returns a non-success status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));

    const client = new A2AClient('http://localhost:3000');
    await expect(client.cancelTask('task-1')).rejects.toThrow('RPC request failed with status 503');
  });

  it('throws when the health endpoint returns a non-success status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));

    const client = new A2AClient('http://localhost:3000');
    await expect(client.health()).rejects.toThrow('Health check failed with status 500');
  });

  it('retries retryable HTTP responses and resolves once the server recovers', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            result: {
              tasks: [],
              total: 0,
            },
            id: '1',
          }),
          { status: 200 },
        ),
      );

    try {
      const client = new A2AClient('http://localhost:3000', {
        fetchImplementation: fetchSpy,
        retry: { maxAttempts: 2, backoffMs: 10, retryOn: [503] },
      });

      const promise = client.listTasks({ limit: 5 });
      await vi.advanceTimersByTimeAsync(10);

      await expect(promise).resolves.toEqual({ tasks: [], total: 0 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries thrown network errors and surfaces the last error after the final attempt', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'));

    try {
      const client = new A2AClient('http://localhost:3000', {
        fetchImplementation: fetchSpy,
        retry: { maxAttempts: 2, backoffMs: 5, retryOn: [503] },
      });

      const assertion = expect(client.health()).rejects.toThrow('network down');
      await vi.advanceTimersByTimeAsync(5);

      await assertion;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AgentRegistryClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls registry endpoints', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'a' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'a' }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'a' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

    const client = new AgentRegistryClient('http://localhost:3099');
    expect((await client.listAgents())[0]?.id).toBe('a');
    expect((await client.getAgent('a')).id).toBe('a');
    expect((await client.searchAgents('writer'))[0]?.id).toBe('a');
    expect((await client.sendHeartbeat('a')).id).toBe('a');
    expect((await client.health())['status']).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('registers agents and forwards search filters to the query string', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'registered' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'matched' }]), { status: 200 }));

    const client = new AgentRegistryClient('http://localhost:3099');
    const card = {
      protocolVersion: '1.0' as const,
      name: 'Agent',
      description: 'desc',
      url: 'http://agent',
      version: '1.0',
    };

    expect((await client.register('http://agent', card)).id).toBe('registered');
    expect((await client.searchAgents('writer', { tag: 'creative', name: 'agent' }))[0]?.id).toBe(
      'matched',
    );

    const [searchUrl] = fetchSpy.mock.calls[1] ?? [];
    const parsedUrl = new URL(searchUrl instanceof URL ? searchUrl.toString() : String(searchUrl));
    expect(parsedUrl.pathname).toBe('/agents/search');
    expect(parsedUrl.searchParams.get('skill')).toBe('writer');
    expect(parsedUrl.searchParams.get('tag')).toBe('creative');
    expect(parsedUrl.searchParams.get('name')).toBe('agent');
  });

  it('exports and imports versioned registry documents through admin endpoints', async () => {
    const registryDocument: RegistryExportDocument = {
      $schema: REGISTRY_EXPORT_SCHEMA_ID,
      schemaVersion: '1',
      exportedAt: '2026-05-25T12:00:00.000Z',
      agents: [
        {
          id: 'agent-1',
          url: 'https://agent.example.com/a2a',
          card: {
            protocolVersion: '1.0' as const,
            name: 'Agent',
            description: 'desc',
            url: 'https://agent.example.com/a2a',
            version: '1.0',
          },
          status: 'unknown' as const,
          tags: [],
          skills: [],
          registeredAt: '2026-05-25T12:00:00.000Z',
          tenantId: 'tenant-a',
          isPublic: true,
        },
      ],
      metadata: {
        source: 'a2amesh-registry',
        agentCount: 1,
        tenants: ['tenant-a'],
        publicAgents: 1,
      },
    };
    const importResult = { imported: 1, updated: 0, skipped: 0, total: 1 };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(registryDocument), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(importResult), { status: 200 }));

    const client = new AgentRegistryClient('http://localhost:3099');

    await expect(client.exportAgents()).resolves.toEqual(registryDocument);
    await expect(client.importAgents(registryDocument)).resolves.toEqual(importResult);

    const [exportInput, exportInit] = fetchSpy.mock.calls[0] ?? [];
    expect(exportInput).toEqual(new URL('/admin/agents/export', 'http://localhost:3099'));
    expect(exportInit).toBeUndefined();

    const [importInput, importInit] = fetchSpy.mock.calls[1] ?? [];
    expect(importInput).toEqual(new URL('/admin/agents/import', 'http://localhost:3099'));
    expect(importInit).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registryDocument),
    });
  });

  it('throws when registry endpoints fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));

    const client = new AgentRegistryClient('http://localhost:3099');
    await expect(
      client.register('http://agent', {
        protocolVersion: '1.0',
        name: 'Agent',
        description: 'desc',
        url: 'http://agent',
        version: '1.0',
      }),
    ).rejects.toThrow('Failed to register agent (500)');
  });

  it('throws for failed list, get, search, heartbeat and health requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    const client = new AgentRegistryClient('http://localhost:3099');
    await expect(client.listAgents()).rejects.toThrow('Failed to list agents (500)');
    await expect(client.getAgent('agent-1')).rejects.toThrow('Failed to fetch agent (500)');
    await expect(client.searchAgents('writer')).rejects.toThrow('Failed to search agents (500)');
    await expect(client.sendHeartbeat('agent-1')).rejects.toThrow('Failed to send heartbeat (500)');
    await expect(client.health()).rejects.toThrow('Failed to fetch registry health (500)');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('throws for failed export and import requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));

    const client = new AgentRegistryClient('http://localhost:3099');
    await expect(client.exportAgents()).rejects.toThrow('Failed to export agents (401)');
    await expect(
      client.importAgents({
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
      }),
    ).rejects.toThrow('Failed to import agents (400)');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('streams registry updates from an SSE endpoint and closes cleanly', async () => {
    const sseServer = createServer((req, res) => {
      if (req.url === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('event: registry_update\ndata: {"type":"registered","id":"agent-1"}\n\n');
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => sseServer.listen(0, '127.0.0.1', () => resolve()));
    const address = sseServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start SSE test server');
    }

    const client = new AgentRegistryClient(`http://127.0.0.1:${address.port}`);
    const events = client.events();

    try {
      const next = await events.next();
      expect(next.value).toEqual({ type: 'registered', id: 'agent-1' });
      await events.return(undefined);
    } finally {
      await new Promise<void>((resolve) => sseServer.close(() => resolve()));
    }
  });

  it('stops event iteration when the SSE endpoint errors', async () => {
    const sseServer = createServer((req, res) => {
      if (req.url === '/events') {
        res.writeHead(500);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => sseServer.listen(0, '127.0.0.1', () => resolve()));
    const address = sseServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start SSE error server');
    }

    const client = new AgentRegistryClient(`http://127.0.0.1:${address.port}`);
    const events = client.events();

    try {
      const next = await events.next();
      expect(next.done).toBe(true);
    } finally {
      await new Promise<void>((resolve) => sseServer.close(() => resolve()));
    }
  });
});

describe('createAuthenticatingFetchWithRetry', () => {
  it('retries with refreshed headers when handler asks for it', async () => {
    const baseFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const wrapped = createAuthenticatingFetchWithRetry(baseFetch, {
      async headers() {
        return { Authorization: 'Bearer first' };
      },
      async shouldRetryWithHeaders(_requestInit, response) {
        if (response.status === 401) {
          return { Authorization: 'Bearer second' };
        }
        return undefined;
      },
    });

    const response = await wrapped('http://localhost/test');
    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });
});
