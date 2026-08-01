import assert from 'node:assert/strict';
import type { Server as HttpServer } from 'node:http';
import { afterEach, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

type ToolName = 'a2a_discover' | 'a2a_send_message' | 'a2a_get_task';

type AuditEvent = {
  selectedMcpTool: string;
  outcome: string;
  reasonCode: string;
};

type AgentConfig = {
  id: string;
  name: string;
  description: string;
  url: string;
  tenantId: string;
  token?: string;
};

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type Bridge = {
  server: {
    connect(transport: InMemoryTransport): Promise<void>;
    close(): Promise<void>;
  };
  invoke(name: ToolName, input: unknown, signal?: AbortSignal): Promise<ToolResult>;
};

type BridgeOptions = {
  agents: AgentConfig[];
  expectedTenantId: string;
  expectedAudience: string;
  authContext: {
    subject?: string;
    clientId?: string;
    subjectClass?: string;
    audience: string;
    scopes: string[];
    tokenSource?: string;
  };
  readApprovalId?: string | undefined;
  sendApprovalId?: string | undefined;
  allowedTools?: ToolName[];
  operationTimeoutMs?: number;
  outboundPolicy?: Record<string, unknown>;
  audit?: (event: AuditEvent) => void | Promise<void>;
  operations?:
    | {
        sendMessage(input: {
          agent: AgentConfig;
          tenantId: string;
          message: string;
          contextId?: string;
          signal: AbortSignal;
        }): Promise<Record<string, unknown>>;
        getTask(input: {
          agent: AgentConfig;
          tenantId: string;
          taskId: string;
          signal: AbortSignal;
        }): Promise<Record<string, unknown>>;
      }
    | undefined;
};

type BridgeModule = {
  A2A_MCP_TOOL_NAMES: readonly ToolName[];
  createA2AMcpBridge(options: BridgeOptions): Bridge;
  createA2AMcpHttpApp(options: BridgeOptions & { transportToken: string; host?: string }): {
    listen(port: number, host: string, callback: () => void): HttpServer;
  };
};

const bridgeModulePath = '../src/server/bridge.js';

async function loadBridgeModule(): Promise<BridgeModule> {
  const loaded = await import(bridgeModulePath).catch(() => undefined);
  assert.ok(loaded, 'A2A Mesh MCP bridge implementation must exist');
  return loaded as BridgeModule;
}

function completedTask(id: string, text: string): Record<string, unknown> {
  return {
    id,
    contextId: 'ctx-1',
    status: { state: 'COMPLETED', timestamp: '2026-07-31T00:00:00.000Z' },
    history: [],
    artifacts: [
      {
        artifactId: 'artifact-1',
        index: 0,
        parts: [{ type: 'text', text }],
      },
    ],
  };
}

function options(overrides: Partial<BridgeOptions> = {}): BridgeOptions {
  return {
    agents: [
      {
        id: 'researcher',
        name: 'Researcher',
        description: 'Allowlisted research agent',
        url: 'https://agent.example.com',
        tenantId: 'tenant-a',
        token: 'top-secret-agent-token',
      },
    ],
    expectedTenantId: 'tenant-a',
    expectedAudience: 'urn:mcp:a2a-bridge',
    authContext: {
      subject: 'sensitive-user-id',
      subjectClass: 'human-user',
      audience: 'urn:mcp:a2a-bridge',
      clientId: 'a2amesh-local',
      scopes: ['a2a:agents:read', 'a2a:messages:send', 'a2a:tasks:read'],
      tokenSource: 'authorization-header',
    },
    readApprovalId: 'read-policy-1',
    sendApprovalId: 'send-approval-1',
    operationTimeoutMs: 200,
    operations: {
      async sendMessage() {
        return completedTask('task-send', 'safe result');
      },
      async getTask() {
        return completedTask('task-get', 'stored result');
      },
    },
    ...overrides,
  };
}

async function connectInMemory(
  bridge: Bridge,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await bridge.server.connect(serverTransport);
  const client = new Client({ name: 'a2amesh-fake-consumer', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await bridge.server.close();
    },
  };
}

it('fake MCP consumer discovers and invokes the bounded A2A Mesh tool set', async () => {
  const module = await loadBridgeModule();
  const audit: AuditEvent[] = [];
  const bridge = module.createA2AMcpBridge(
    options({
      audit(event) {
        audit.push(event);
      },
    }),
  );
  const connection = await connectInMemory(bridge);

  try {
    const tools = await connection.client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...module.A2A_MCP_TOOL_NAMES].sort(),
    );

    const discovered = await connection.client.callTool({
      name: 'a2a_discover',
      arguments: { tenantId: 'tenant-a' },
    });
    assert.equal('isError' in discovered ? discovered.isError : undefined, false);
    assert.match(JSON.stringify(discovered), /researcher/);
    assert.doesNotMatch(JSON.stringify(discovered), /agent\.example\.com|top-secret-agent-token/);

    const sent = await connection.client.callTool({
      name: 'a2a_send_message',
      arguments: {
        tenantId: 'tenant-a',
        agentId: 'researcher',
        message: 'private prompt value',
        contextId: 'ctx-1',
      },
    });
    assert.equal('isError' in sent ? sent.isError : undefined, false);
    assert.match(JSON.stringify(sent), /task-send|safe result/);

    const fetched = await connection.client.callTool({
      name: 'a2a_get_task',
      arguments: { tenantId: 'tenant-a', agentId: 'researcher', taskId: 'task-get' },
    });
    assert.equal('isError' in fetched ? fetched.isError : undefined, false);
    assert.match(JSON.stringify(fetched), /task-get|stored result/);

    const auditJson = JSON.stringify(audit);
    assert.doesNotMatch(auditJson, /private prompt value|sensitive-user-id|top-secret-agent-token/);
    assert.ok(audit.some((event) => event.selectedMcpTool === 'a2a_send_message'));
  } finally {
    await connection.close();
  }
});

it('authorization fails closed for tenant, scope, allowlist, and approval violations', async () => {
  const module = await loadBridgeModule();
  let operationCalls = 0;
  const operations = {
    async sendMessage() {
      operationCalls += 1;
      return completedTask('unexpected', 'unexpected');
    },
    async getTask() {
      operationCalls += 1;
      return completedTask('unexpected', 'unexpected');
    },
  };

  const noApproval = module.createA2AMcpBridge(options({ sendApprovalId: undefined, operations }));
  const approvalResult = await noApproval.invoke('a2a_send_message', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    message: 'hello',
  });
  assert.equal(approvalResult.isError, true);
  assert.match(JSON.stringify(approvalResult), /mcp-consent-required/);

  const wrongTenant = module.createA2AMcpBridge(options({ operations }));
  const tenantResult = await wrongTenant.invoke('a2a_get_task', {
    tenantId: 'tenant-b',
    agentId: 'researcher',
    taskId: 'task-1',
  });
  assert.equal(tenantResult.isError, true);
  assert.match(JSON.stringify(tenantResult), /mcp-tenant-mismatch/);

  const missingScope = module.createA2AMcpBridge(
    options({
      authContext: {
        clientId: 'a2amesh-local',
        audience: 'urn:mcp:a2a-bridge',
        scopes: ['a2a:agents:read'],
      },
      operations,
    }),
  );
  const scopeResult = await missingScope.invoke('a2a_get_task', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    taskId: 'task-1',
  });
  assert.equal(scopeResult.isError, true);
  assert.match(JSON.stringify(scopeResult), /mcp-scope-missing/);

  const restricted = module.createA2AMcpBridge(
    options({ allowedTools: ['a2a_discover'], operations }),
  );
  const allowlistResult = await restricted.invoke('a2a_send_message', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    message: 'hello',
  });
  assert.equal(allowlistResult.isError, true);
  assert.match(JSON.stringify(allowlistResult), /mcp-tool-blocked/);
  assert.equal(operationCalls, 0);
});

it('unavailable and unsafe destinations fail before A2A network access', async () => {
  const module = await loadBridgeModule();
  let operationCalls = 0;
  const bridge = module.createA2AMcpBridge(
    options({
      operations: {
        async sendMessage() {
          operationCalls += 1;
          return completedTask('unexpected', 'unexpected');
        },
        async getTask() {
          operationCalls += 1;
          return completedTask('unexpected', 'unexpected');
        },
      },
    }),
  );
  const missing = await bridge.invoke('a2a_get_task', {
    tenantId: 'tenant-a',
    agentId: 'missing',
    taskId: 'task-1',
  });
  assert.equal(missing.isError, true);
  assert.match(JSON.stringify(missing), /mcp-agent-unavailable/);
  assert.equal(operationCalls, 0);

  const unsafeOptions = options({
    agents: [
      {
        id: 'local-agent',
        name: 'Local Agent',
        description: 'Unsafe default destination',
        url: 'http://127.0.0.1:9999',
        tenantId: 'tenant-a',
      },
    ],
  });
  delete unsafeOptions.operations;
  const unsafe = module.createA2AMcpBridge(unsafeOptions);
  const blocked = await unsafe.invoke('a2a_get_task', {
    tenantId: 'tenant-a',
    agentId: 'local-agent',
    taskId: 'task-1',
  });
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked), /mcp-outbound-policy-denied/);
});

it('timeout and caller cancellation return bounded reason codes', async () => {
  const module = await loadBridgeModule();
  const waitForAbort = ({ signal }: { signal: AbortSignal }): Promise<Record<string, unknown>> =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const operations = {
    sendMessage: waitForAbort,
    getTask: waitForAbort,
  } as NonNullable<BridgeOptions['operations']>;

  const timed = module.createA2AMcpBridge(options({ operationTimeoutMs: 20, operations }));
  const timeoutResult = await timed.invoke('a2a_get_task', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    taskId: 'task-1',
  });
  assert.equal(timeoutResult.isError, true);
  assert.match(JSON.stringify(timeoutResult), /mcp-operation-timeout/);

  const cancelled = module.createA2AMcpBridge(options({ operations }));
  const controller = new AbortController();
  const pending = cancelled.invoke(
    'a2a_send_message',
    { tenantId: 'tenant-a', agentId: 'researcher', message: 'hello' },
    controller.signal,
  );
  controller.abort(new Error('private cancellation detail'));
  const cancellationResult = await pending;
  assert.equal(cancellationResult.isError, true);
  assert.match(JSON.stringify(cancellationResult), /mcp-operation-cancelled/);
  assert.doesNotMatch(JSON.stringify(cancellationResult), /private cancellation detail/);
});

it('Streamable HTTP requires a bearer token and supports the fake consumer probe', async () => {
  const module = await loadBridgeModule();
  const app = module.createA2AMcpHttpApp({
    ...options(),
    host: '127.0.0.1',
    transportToken: 'http-transport-secret',
  });
  const listener = await new Promise<HttpServer>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });

  try {
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);

    const unauthorized = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(unauthorized.status, 401);
    assert.doesNotMatch(await unauthorized.text(), /http-transport-secret/);

    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: 'Bearer http-transport-secret' } },
    });
    const client = new Client({ name: 'a2amesh-http-fake', version: '1.0.0' });
    await client.connect(transport as never);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...module.A2A_MCP_TOOL_NAMES].sort(),
    );
    await client.close();
  } finally {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

type HttpModule = {
  createA2AMcpHttpAppWithFactory(
    options: BridgeOptions & { transportToken: string; host?: string },
    createBridge: (options: BridgeOptions & { transportToken: string; host?: string }) => Bridge,
  ): {
    listen(port: number, host: string, callback: () => void): HttpServer;
  };
};

const httpModulePath = '../src/server/http.js';

async function loadHttpModule(): Promise<HttpModule> {
  const loaded = await import(httpModulePath).catch(() => undefined);
  assert.ok(loaded, 'A2A Mesh MCP HTTP implementation must exist');
  return loaded as HttpModule;
}

it('Streamable HTTP closes request-scoped MCP resources after each response', async () => {
  const bridgeModule = await loadBridgeModule();
  const httpModule = await loadHttpModule();
  let closeCalls = 0;
  const app = httpModule.createA2AMcpHttpAppWithFactory(
    {
      ...options(),
      host: '127.0.0.1',
      transportToken: 'http-transport-secret',
    },
    (bridgeOptions) => {
      const bridge = bridgeModule.createA2AMcpBridge(bridgeOptions);
      const close = bridge.server.close.bind(bridge.server);
      bridge.server.close = async () => {
        closeCalls += 1;
        await close();
      };
      return bridge;
    },
  );
  const listener = await new Promise<HttpServer>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });

  try {
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: 'Bearer http-transport-secret' } },
    });
    const client = new Client({ name: 'a2amesh-http-cleanup', version: '1.0.0' });
    await client.connect(transport as never);
    await client.listTools();
    await client.close();

    const deadline = Date.now() + 1_000;
    while (closeCalls === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(closeCalls > 0, 'request-scoped MCP resources must be closed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

type RuntimeConfig = {
  transport: 'streamable-http' | 'stdio';
  host: string;
  port: number;
  transportToken?: string;
  bridgeOptions: BridgeOptions;
};

type ConfigModule = {
  loadA2AMcpRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig;
};

const configModulePath = '../src/server/config.js';

async function loadConfigModule(): Promise<ConfigModule> {
  const loaded = await import(configModulePath).catch(() => undefined);
  assert.ok(loaded, 'A2A Mesh MCP configuration implementation must exist');
  return loaded as ConfigModule;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return {
    A2AMESH_MCP_TRANSPORT: 'streamable-http',
    A2AMESH_MCP_HOST: '127.0.0.1',
    A2AMESH_MCP_PORT: '3097',
    A2AMESH_MCP_SERVER_TOKEN: 'transport-secret-value',
    A2AMESH_MCP_TENANT_ID: 'tenant-a',
    A2AMESH_MCP_AUDIENCE: 'urn:mcp:a2a-bridge',
    A2AMESH_MCP_CLIENT_ID: 'a2amesh-local',
    A2AMESH_MCP_SCOPES: 'a2a:agents:read,a2a:messages:send,a2a:tasks:read',
    A2AMESH_MCP_READ_APPROVAL_ID: 'read-policy-1',
    A2AMESH_MCP_SEND_APPROVAL_ID: 'send-approval-1',
    A2AMESH_MCP_TIMEOUT_MS: '30000',
    A2AMESH_MCP_ALLOW_LOCALHOST: '0',
    A2AMESH_MCP_ALLOW_PRIVATE_NETWORKS: '0',
    A2AMESH_MCP_ALLOWED_TOOLS: 'a2a_discover,a2a_send_message,a2a_get_task',
    A2AMESH_MCP_AGENTS_JSON: JSON.stringify([
      {
        id: 'researcher',
        name: 'Researcher',
        description: 'Allowlisted agent',
        url: 'https://agent.example.com',
        tokenEnv: 'A2AMESH_RESEARCHER_TOKEN',
      },
    ]),
    A2AMESH_RESEARCHER_TOKEN: 'agent-secret-value',
  };
}

it('runtime configuration resolves named credentials without accepting inline secrets', async () => {
  const module = await loadConfigModule();
  const config = module.loadA2AMcpRuntimeConfig(safeEnvironment());

  assert.equal(config.transport, 'streamable-http');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3097);
  assert.equal(config.transportToken, 'transport-secret-value');
  assert.equal(config.bridgeOptions.agents[0]?.tenantId, 'tenant-a');
  assert.equal(config.bridgeOptions.agents[0]?.token, 'agent-secret-value');
  assert.deepEqual(config.bridgeOptions.allowedTools, [
    'a2a_discover',
    'a2a_send_message',
    'a2a_get_task',
  ]);

  const inlineSecretEnv = safeEnvironment();
  inlineSecretEnv['A2AMESH_MCP_AGENTS_JSON'] = JSON.stringify([
    {
      id: 'bad',
      name: 'Bad',
      description: 'Bad config',
      url: 'https://agent.example.com',
      token: 'must-not-be-accepted',
    },
  ]);
  assert.throws(
    () => module.loadA2AMcpRuntimeConfig(inlineSecretEnv),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /must-not-be-accepted/);
      return true;
    },
  );
});

it('runtime configuration rejects unsafe bindings and incomplete approval policy', async () => {
  const module = await loadConfigModule();
  const remote = safeEnvironment();
  remote['A2AMESH_MCP_HOST'] = '0.0.0.0';
  assert.throws(() => module.loadA2AMcpRuntimeConfig(remote), /loopback/);

  const missingApproval = safeEnvironment();
  delete missingApproval['A2AMESH_MCP_SEND_APPROVAL_ID'];
  assert.throws(() => module.loadA2AMcpRuntimeConfig(missingApproval), /SEND_APPROVAL_ID/);

  const unknownTool = safeEnvironment();
  unknownTool['A2AMESH_MCP_ALLOWED_TOOLS'] = 'a2a_discover,shell_exec';
  assert.throws(() => module.loadA2AMcpRuntimeConfig(unknownTool), /allowed tool/);
});

it('invalid MCP tool arguments are denied with redacted audit evidence', async () => {
  const module = await loadBridgeModule();
  const audit: AuditEvent[] = [];
  const bridge = module.createA2AMcpBridge(
    options({
      audit(event) {
        audit.push(event);
      },
    }),
  );
  const result = await bridge.invoke('a2a_send_message', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    message: 'private-invalid-prompt',
    credential: 'must-not-appear',
  });

  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /mcp-invalid-tool-arguments/);
  assert.ok(
    audit.some(
      (event) => event.outcome === 'denied' && event.reasonCode === 'mcp-invalid-tool-arguments',
    ),
  );
  assert.doesNotMatch(JSON.stringify(audit), /private-invalid-prompt|must-not-appear/);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('runs the default send operation through the outbound policy and named credential', async () => {
  const { createDefaultA2AOperations } = await import('../src/server/operations.js');
  const agent = {
    id: 'local-agent',
    name: 'Local Agent',
    description: 'Loopback test agent',
    url: 'http://127.0.0.1:39991',
    tenantId: 'tenant-a',
    token: 'named-agent-token',
  };
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id?: unknown };
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer named-agent-token');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id ?? null,
        result: completedTask('task-default-send', 'safe default result'),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  const operations = createDefaultA2AOperations(
    options({
      agents: [agent],
      operations: undefined,
      outboundPolicy: { allowLocalhost: true },
    }) as never,
  );

  const task = await operations.sendMessage({
    agent,
    tenantId: 'tenant-a',
    message: 'hello',
    contextId: 'ctx-1',
    signal: new AbortController().signal,
  });

  assert.equal(task.id, 'task-default-send');
  const fetched = await operations.getTask({
    agent,
    tenantId: 'tenant-a',
    taskId: 'task-default-get',
    signal: new AbortController().signal,
  });
  assert.equal(fetched.id, 'task-default-send');
  assert.equal(fetchSpy.mock.calls.length, 2);
});

it('redacts credential-shaped task output and omits binary data', async () => {
  const { createA2ATaskSummary, redactA2AOutput } = await import('../src/server/operations.js');
  const secret = 'named-secret-value';
  const task = {
    id: `task-${secret}`,
    contextId: 'ctx-secret',
    status: { state: 'COMPLETED', timestamp: '2026-08-01T00:00:00.000Z' },
    history: [],
    artifacts: [
      {
        artifactId: 'artifact-1',
        index: 0,
        parts: [
          { type: 'text', text: `token=${secret} Bearer abc.def.ghi` },
          { type: 'data', data: { apiKey: 'sk-abcdefghijklmnop' } },
          { type: 'file', file: { name: 'private.bin', mimeType: 'application/octet-stream' } },
        ],
      },
    ],
  };

  const summary = createA2ATaskSummary(task as never, [secret]);
  const encoded = JSON.stringify(summary);
  assert.doesNotMatch(encoded, /named-secret-value|abc\.def\.ghi|sk-abcdefghijklmnop/);
  assert.match(encoded, /\[REDACTED\]|Binary file omitted/);
  assert.equal(redactA2AOutput('x'.repeat(9_000), []).length, 8_193);
});

it('rejects malformed standalone runtime settings at each fail-closed boundary', async () => {
  const module = await loadConfigModule();
  const cases: Array<[string, (env: NodeJS.ProcessEnv) => void, RegExp]> = [
    ['missing tenant', (env) => delete env['A2AMESH_MCP_TENANT_ID'], /TENANT_ID/],
    ['zero timeout', (env) => (env['A2AMESH_MCP_TIMEOUT_MS'] = '0'), /positive integer/],
    [
      'invalid boolean',
      (env) => (env['A2AMESH_MCP_ALLOW_LOCALHOST'] = 'yes'),
      /0, 1, false, or true/,
    ],
    ['invalid transport', (env) => (env['A2AMESH_MCP_TRANSPORT'] = 'socket'), /transport/i],
    ['invalid port', (env) => (env['A2AMESH_MCP_PORT'] = '70000'), /between 1 and 65535/],
    ['invalid JSON', (env) => (env['A2AMESH_MCP_AGENTS_JSON'] = '{'), /valid JSON/],
    [
      'invalid URL',
      (env) =>
        (env['A2AMESH_MCP_AGENTS_JSON'] = JSON.stringify([
          { id: 'bad', name: 'Bad', description: 'Bad URL', url: 'not-a-url' },
        ])),
      /invalid URL/,
    ],
    [
      'unsupported URL scheme',
      (env) =>
        (env['A2AMESH_MCP_AGENTS_JSON'] = JSON.stringify([
          { id: 'bad', name: 'Bad', description: 'Bad URL', url: 'file:///tmp/agent' },
        ])),
      /HTTP or HTTPS/,
    ],
    [
      'URL credentials',
      (env) =>
        (env['A2AMESH_MCP_AGENTS_JSON'] = JSON.stringify([
          {
            id: 'bad',
            name: 'Bad',
            description: 'Bad URL',
            url: 'https://user:pass@agent.example.com/path?secret=1',
          },
        ])),
      /credentials, query strings, or fragments/,
    ],
    [
      'duplicate agents',
      (env) => {
        const agent = {
          id: 'duplicate',
          name: 'Duplicate',
          description: 'Duplicate',
          url: 'https://agent.example.com',
        };
        env['A2AMESH_MCP_AGENTS_JSON'] = JSON.stringify([agent, agent]);
      },
      /unique/,
    ],
    [
      'missing named credential',
      (env) => delete env['A2AMESH_RESEARCHER_TOKEN'],
      /Missing credential environment variable/,
    ],
    [
      'missing read approval',
      (env) => delete env['A2AMESH_MCP_READ_APPROVAL_ID'],
      /READ_APPROVAL_ID/,
    ],
  ];

  for (const [label, mutate, expected] of cases) {
    const env = safeEnvironment();
    mutate(env);
    assert.throws(() => module.loadA2AMcpRuntimeConfig(env), expected, label);
  }

  const defaults = safeEnvironment();
  delete defaults['A2AMESH_MCP_ALLOW_LOCALHOST'];
  delete defaults['A2AMESH_MCP_ALLOW_PRIVATE_NETWORKS'];
  const defaulted = module.loadA2AMcpRuntimeConfig(defaults);
  assert.deepEqual(defaulted.bridgeOptions.outboundPolicy, {
    allowLocalhost: false,
    allowPrivateNetworks: false,
  });

  const enabled = safeEnvironment();
  enabled['A2AMESH_MCP_ALLOW_LOCALHOST'] = 'true';
  enabled['A2AMESH_MCP_ALLOW_PRIVATE_NETWORKS'] = '1';
  assert.deepEqual(module.loadA2AMcpRuntimeConfig(enabled).bridgeOptions.outboundPolicy, {
    allowLocalhost: true,
    allowPrivateNetworks: true,
  });
});

it('returns method-not-allowed for authenticated DELETE requests', async () => {
  const module = await loadBridgeModule();
  const app = module.createA2AMcpHttpApp({
    ...options(),
    host: '127.0.0.1',
    transportToken: 'http-transport-secret',
  });
  const listener = await new Promise<HttpServer>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  try {
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer http-transport-secret' },
    });
    assert.equal(response.status, 405);
  } finally {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

it('fails closed when discovery audit emission fails', async () => {
  const module = await loadBridgeModule();
  let calls = 0;
  const bridge = module.createA2AMcpBridge(
    options({
      audit() {
        calls += 1;
        if (calls === 2) throw new Error('private audit failure');
      },
    }),
  );
  const result = await bridge.invoke('a2a_discover', { tenantId: 'tenant-a' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /mcp-audit-failed/);
  assert.doesNotMatch(JSON.stringify(result), /private audit failure/);
});

it('covers fail-closed audit and authorization branches without leaking errors', async () => {
  const module = await loadBridgeModule();

  const discoveryAuditFailure = module.createA2AMcpBridge(
    options({
      audit() {
        throw new Error('private discovery audit detail');
      },
    }),
  );
  assert.match(
    JSON.stringify(await discoveryAuditFailure.invoke('a2a_discover', { tenantId: 'tenant-a' })),
    /mcp-audit-failed/,
  );

  const blockedDiscovery = module.createA2AMcpBridge(options({ readApprovalId: undefined }));
  assert.match(
    JSON.stringify(await blockedDiscovery.invoke('a2a_discover', { tenantId: 'tenant-a' })),
    /mcp-consent-required/,
  );

  const toolAuditFailure = module.createA2AMcpBridge(
    options({
      audit() {
        throw new Error('private tool audit detail');
      },
    }),
  );
  assert.match(
    JSON.stringify(
      await toolAuditFailure.invoke('a2a_get_task', {
        tenantId: 'tenant-a',
        agentId: 'researcher',
        taskId: 'task-1',
      }),
    ),
    /mcp-audit-failed/,
  );

  let unavailableAuditCalls = 0;
  const unavailableAuditFailure = module.createA2AMcpBridge(
    options({
      audit() {
        unavailableAuditCalls += 1;
        if (unavailableAuditCalls === 2) throw new Error('private unavailable audit detail');
      },
    }),
  );
  assert.match(
    JSON.stringify(
      await unavailableAuditFailure.invoke('a2a_get_task', {
        tenantId: 'tenant-a',
        agentId: 'missing',
        taskId: 'task-1',
      }),
    ),
    /mcp-audit-failed/,
  );

  let failureAuditCalls = 0;
  const operationAuditFailure = module.createA2AMcpBridge(
    options({
      audit() {
        failureAuditCalls += 1;
        if (failureAuditCalls === 2) throw new Error('private operation audit detail');
      },
      operations: {
        async sendMessage() {
          throw new Error('private operation failure');
        },
        async getTask() {
          throw new Error('private operation failure');
        },
      },
    }),
  );
  assert.match(
    JSON.stringify(
      await operationAuditFailure.invoke('a2a_get_task', {
        tenantId: 'tenant-a',
        agentId: 'researcher',
        taskId: 'task-1',
      }),
    ),
    /mcp-audit-failed/,
  );

  const invalidInputAuditFailure = module.createA2AMcpBridge(
    options({
      audit() {
        throw new Error('private invalid input audit detail');
      },
    }),
  );
  const invalid = await invalidInputAuditFailure.invoke('a2a_send_message', null);
  assert.match(JSON.stringify(invalid), /mcp-audit-failed/);
  assert.doesNotMatch(JSON.stringify(invalid), /private/);
});

it('rejects an empty HTTP token and returns a bounded server error on connection failure', async () => {
  const bridgeModule = await loadBridgeModule();
  assert.throws(
    () =>
      bridgeModule.createA2AMcpHttpApp({
        ...options(),
        transportToken: '   ',
      }),
    /non-empty/,
  );

  const httpModule = await loadHttpModule();
  const app = httpModule.createA2AMcpHttpAppWithFactory(
    {
      ...options(),
      host: '127.0.0.1',
      transportToken: 'http-transport-secret',
    },
    () =>
      ({
        server: {
          async connect() {
            throw new Error('private connection failure');
          },
          async close() {},
        },
        async invoke() {
          throw new Error('not used');
        },
      }) as never,
  );
  const listener = await new Promise<HttpServer>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  try {
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer http-transport-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private connection failure/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

it('maps unexpected bounded-operation failures to the public reason code', async () => {
  const { runBoundedA2AOperation } = await import('../src/server/operations.js');
  await assert.rejects(
    () =>
      runBoundedA2AOperation(
        async () => {
          throw new Error('private provider failure');
        },
        undefined,
        100,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'mcp-operation-failed');
      return true;
    },
  );
});
