import assert from 'node:assert/strict';
import type { Server as HttpServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  A2A_MCP_TOOL_NAMES as OPENCLAW_MCP_TOOL_NAMES,
  createA2AMcpBridge as createOpenClawMcpBridge,
  createA2AMcpHttpApp as createOpenClawMcpHttpApp,
  createA2AMcpHttpAppWithFactory as createOpenClawMcpHttpAppWithFactory,
} from '@a2amesh/mcp/server';

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
  OPENCLAW_MCP_TOOL_NAMES: readonly ToolName[];
  createOpenClawMcpBridge(options: BridgeOptions): Bridge;
  createOpenClawMcpHttpApp(options: BridgeOptions & { transportToken: string; host?: string }): {
    listen(port: number, host: string, callback: () => void): HttpServer;
  };
};

const bridgeModule: BridgeModule = {
  OPENCLAW_MCP_TOOL_NAMES,
  createOpenClawMcpBridge:
    createOpenClawMcpBridge as unknown as BridgeModule['createOpenClawMcpBridge'],
  createOpenClawMcpHttpApp:
    createOpenClawMcpHttpApp as unknown as BridgeModule['createOpenClawMcpHttpApp'],
};

async function loadBridgeModule(): Promise<BridgeModule> {
  return bridgeModule;
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
      clientId: 'openclaw-local',
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
  const client = new Client({ name: 'openclaw-fake-consumer', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await bridge.server.close();
    },
  };
}

void test('fake MCP consumer discovers and invokes the bounded OpenClaw tool set', async () => {
  const module = await loadBridgeModule();
  const audit: AuditEvent[] = [];
  const bridge = module.createOpenClawMcpBridge(
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
      [...module.OPENCLAW_MCP_TOOL_NAMES].sort(),
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

void test('authorization fails closed for tenant, scope, allowlist, and approval violations', async () => {
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

  const noApproval = module.createOpenClawMcpBridge(
    options({ sendApprovalId: undefined, operations }),
  );
  const approvalResult = await noApproval.invoke('a2a_send_message', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    message: 'hello',
  });
  assert.equal(approvalResult.isError, true);
  assert.match(JSON.stringify(approvalResult), /mcp-consent-required/);

  const wrongTenant = module.createOpenClawMcpBridge(options({ operations }));
  const tenantResult = await wrongTenant.invoke('a2a_get_task', {
    tenantId: 'tenant-b',
    agentId: 'researcher',
    taskId: 'task-1',
  });
  assert.equal(tenantResult.isError, true);
  assert.match(JSON.stringify(tenantResult), /mcp-tenant-mismatch/);

  const missingScope = module.createOpenClawMcpBridge(
    options({
      authContext: {
        clientId: 'openclaw-local',
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

  const restricted = module.createOpenClawMcpBridge(
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

void test('unavailable and unsafe destinations fail before A2A network access', async () => {
  const module = await loadBridgeModule();
  let operationCalls = 0;
  const bridge = module.createOpenClawMcpBridge(
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
  const unsafe = module.createOpenClawMcpBridge(unsafeOptions);
  const blocked = await unsafe.invoke('a2a_get_task', {
    tenantId: 'tenant-a',
    agentId: 'local-agent',
    taskId: 'task-1',
  });
  assert.equal(blocked.isError, true);
  assert.match(JSON.stringify(blocked), /mcp-outbound-policy-denied/);
});

void test('timeout and caller cancellation return bounded reason codes', async () => {
  const module = await loadBridgeModule();
  const waitForAbort = ({ signal }: { signal: AbortSignal }): Promise<Record<string, unknown>> =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const operations = {
    sendMessage: waitForAbort,
    getTask: waitForAbort,
  } as NonNullable<BridgeOptions['operations']>;

  const timed = module.createOpenClawMcpBridge(options({ operationTimeoutMs: 20, operations }));
  const timeoutResult = await timed.invoke('a2a_get_task', {
    tenantId: 'tenant-a',
    agentId: 'researcher',
    taskId: 'task-1',
  });
  assert.equal(timeoutResult.isError, true);
  assert.match(JSON.stringify(timeoutResult), /mcp-operation-timeout/);

  const cancelled = module.createOpenClawMcpBridge(options({ operations }));
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

void test('Streamable HTTP requires a bearer token and supports the fake consumer probe', async () => {
  const module = await loadBridgeModule();
  const app = module.createOpenClawMcpHttpApp({
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
    const client = new Client({ name: 'openclaw-http-fake', version: '1.0.0' });
    await client.connect(transport as never);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...module.OPENCLAW_MCP_TOOL_NAMES].sort(),
    );
    await client.close();
  } finally {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

type HttpModule = {
  createOpenClawMcpHttpAppWithFactory(
    options: BridgeOptions & { transportToken: string; host?: string },
    createBridge: (options: BridgeOptions & { transportToken: string; host?: string }) => Bridge,
  ): {
    listen(port: number, host: string, callback: () => void): HttpServer;
  };
};

const httpModule: HttpModule = {
  createOpenClawMcpHttpAppWithFactory:
    createOpenClawMcpHttpAppWithFactory as unknown as HttpModule['createOpenClawMcpHttpAppWithFactory'],
};

async function loadHttpModule(): Promise<HttpModule> {
  return httpModule;
}

void test('Streamable HTTP closes request-scoped MCP resources after each response', async () => {
  const bridgeModule = await loadBridgeModule();
  const httpModule = await loadHttpModule();
  let closeCalls = 0;
  const app = httpModule.createOpenClawMcpHttpAppWithFactory(
    {
      ...options(),
      host: '127.0.0.1',
      transportToken: 'http-transport-secret',
    },
    (bridgeOptions) => {
      const bridge = bridgeModule.createOpenClawMcpBridge(bridgeOptions);
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
    const client = new Client({ name: 'openclaw-http-cleanup', version: '1.0.0' });
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
  loadOpenClawMcpRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig;
  createOpenClawProbeCommands(serverName: string): string[][];
};

const configModulePath = '../src/config.js';

async function loadConfigModule(): Promise<ConfigModule> {
  const loaded = await import(configModulePath).catch(() => undefined);
  assert.ok(loaded, 'OpenClaw MCP configuration implementation must exist');
  return loaded as ConfigModule;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return {
    A2AMESH_OPENCLAW_MCP_TRANSPORT: 'streamable-http',
    A2AMESH_OPENCLAW_MCP_HOST: '127.0.0.1',
    A2AMESH_OPENCLAW_MCP_PORT: '3097',
    A2AMESH_OPENCLAW_MCP_SERVER_TOKEN: 'transport-secret-value',
    A2AMESH_OPENCLAW_MCP_TENANT_ID: 'tenant-a',
    A2AMESH_OPENCLAW_MCP_AUDIENCE: 'urn:mcp:a2a-bridge',
    A2AMESH_OPENCLAW_MCP_CLIENT_ID: 'openclaw-local',
    A2AMESH_OPENCLAW_MCP_SCOPES: 'a2a:agents:read,a2a:messages:send,a2a:tasks:read',
    A2AMESH_OPENCLAW_MCP_READ_APPROVAL_ID: 'read-policy-1',
    A2AMESH_OPENCLAW_MCP_SEND_APPROVAL_ID: 'send-approval-1',
    A2AMESH_OPENCLAW_MCP_TIMEOUT_MS: '30000',
    A2AMESH_OPENCLAW_MCP_ALLOWED_TOOLS: 'a2a_discover,a2a_send_message,a2a_get_task',
    A2AMESH_OPENCLAW_MCP_AGENTS_JSON: JSON.stringify([
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

void test('runtime configuration resolves named credentials without accepting inline secrets', async () => {
  const module = await loadConfigModule();
  const config = module.loadOpenClawMcpRuntimeConfig(safeEnvironment());

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
  inlineSecretEnv['A2AMESH_OPENCLAW_MCP_AGENTS_JSON'] = JSON.stringify([
    {
      id: 'bad',
      name: 'Bad',
      description: 'Bad config',
      url: 'https://agent.example.com',
      token: 'must-not-be-accepted',
    },
  ]);
  assert.throws(
    () => module.loadOpenClawMcpRuntimeConfig(inlineSecretEnv),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /must-not-be-accepted/);
      return true;
    },
  );
});

void test('runtime configuration rejects unsafe bindings and incomplete approval policy', async () => {
  const module = await loadConfigModule();
  const remote = safeEnvironment();
  remote['A2AMESH_OPENCLAW_MCP_HOST'] = '0.0.0.0';
  assert.throws(() => module.loadOpenClawMcpRuntimeConfig(remote), /loopback/);

  const missingApproval = safeEnvironment();
  delete missingApproval['A2AMESH_OPENCLAW_MCP_SEND_APPROVAL_ID'];
  assert.throws(() => module.loadOpenClawMcpRuntimeConfig(missingApproval), /SEND_APPROVAL_ID/);

  const unknownTool = safeEnvironment();
  unknownTool['A2AMESH_OPENCLAW_MCP_ALLOWED_TOOLS'] = 'a2a_discover,shell_exec';
  assert.throws(() => module.loadOpenClawMcpRuntimeConfig(unknownTool), /allowed tool/);
});

void test('live OpenClaw probe commands are read-only and deterministic', async () => {
  const module = await loadConfigModule();
  assert.deepEqual(module.createOpenClawProbeCommands('a2amesh'), [
    ['mcp', 'status', '--verbose'],
    ['mcp', 'doctor', 'a2amesh', '--probe', '--json'],
    ['mcp', 'probe', 'a2amesh', '--json'],
  ]);
});

void test('stdio transport exposes the same bounded tool set to a spawned MCP consumer', async () => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const environment = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...safeEnvironment(),
      A2AMESH_OPENCLAW_MCP_TRANSPORT: 'stdio',
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../src/index.js', import.meta.url).pathname],
    env: environment,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'openclaw-stdio-fake', version: '1.0.0' });

  try {
    await client.connect(transport as never);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'a2a_discover',
      'a2a_get_task',
      'a2a_send_message',
    ]);
  } finally {
    await client.close().catch(() => undefined);
  }
});

type ProbeModule = {
  runOpenClawProbe(options: {
    env: NodeJS.ProcessEnv;
    runCommand?: (
      command: string,
      args: string[],
      env: NodeJS.ProcessEnv,
    ) => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
  }): Promise<{
    serverName: string;
    commands: string[];
    output: string;
  }>;
};

const probeModulePath = '../src/liveProbe.js';

async function loadProbeModule(): Promise<ProbeModule> {
  const loaded = await import(probeModulePath).catch(() => undefined);
  assert.ok(loaded, 'OpenClaw live probe implementation must exist');
  return loaded as ProbeModule;
}

void test('live OpenClaw probe is opt-in and redacts command output', async () => {
  const module = await loadProbeModule();
  await assert.rejects(() => module.runOpenClawProbe({ env: {} }), /A2AMESH_OPENCLAW_LIVE=1/);

  const calls: string[] = [];
  const result = await module.runOpenClawProbe({
    env: {
      ...safeEnvironment(),
      A2AMESH_OPENCLAW_LIVE: '1',
      A2AMESH_OPENCLAW_BIN: '/opt/openclaw/bin/openclaw',
      A2AMESH_OPENCLAW_MCP_SERVER_NAME: 'a2amesh',
    },
    async runCommand(command, args) {
      calls.push([command, ...args].join(' '));
      return {
        exitCode: 0,
        stdout: `ok token=transport-secret-value`,
        stderr: 'Bearer agent-secret-value',
      };
    },
  });

  assert.deepEqual(result.commands, [
    'mcp status --verbose',
    'mcp doctor a2amesh --probe --json',
    'mcp probe a2amesh --json',
  ]);
  assert.equal(calls.length, 3);
  assert.match(result.output, /\[REDACTED\]/);
  assert.doesNotMatch(result.output, /transport-secret-value|agent-secret-value/);
});

void test('invalid MCP tool arguments are denied with redacted audit evidence', async () => {
  const module = await loadBridgeModule();
  const audit: AuditEvent[] = [];
  const bridge = module.createOpenClawMcpBridge(
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
