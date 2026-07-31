import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const serverModulePath = '../src/server/index.js';

type ToolName = 'a2a_discover' | 'a2a_get_task' | 'a2a_send_message';

type ServerModule = {
  A2A_MCP_TOOL_NAMES: readonly ToolName[];
  createA2AMcpBridge(options: {
    agents: Array<{
      id: string;
      name: string;
      description: string;
      url: string;
      tenantId: string;
      token?: string;
    }>;
    expectedTenantId: string;
    expectedAudience: string;
    authContext: {
      clientId: string;
      audience: string;
      scopes: string[];
      subjectClass: string;
      tokenSource: string;
    };
    readApprovalId: string;
    sendApprovalId: string;
    operations: {
      sendMessage(): Promise<Record<string, unknown>>;
      getTask(): Promise<Record<string, unknown>>;
    };
  }): {
    server: {
      connect(transport: InMemoryTransport): Promise<void>;
      close(): Promise<void>;
    };
  };
  loadA2AMcpRuntimeConfig(
    env: NodeJS.ProcessEnv,
    overrides?: { transport?: 'stdio' | 'streamable-http' },
  ): {
    transport: 'stdio' | 'streamable-http';
    bridgeOptions: {
      agents: Array<{ id: string; token?: string }>;
      allowedTools?: readonly ToolName[];
      outboundPolicy?: { allowLocalhost?: boolean; allowPrivateNetworks?: boolean };
    };
  };
  parseA2AMcpServerArgs(
    args: string[],
  ):
    | { action: 'help' }
    | { action: 'version' }
    | { action: 'start'; transport?: 'stdio' | 'streamable-http' };
  renderA2AMcpServerHelp(): string;
};

async function loadServerModule(): Promise<ServerModule> {
  const loaded = await import(serverModulePath).catch(() => undefined);
  expect(loaded, 'standalone MCP server module must exist').toBeDefined();
  return loaded as ServerModule;
}

function completedTask(id: string): Record<string, unknown> {
  return {
    id,
    contextId: 'ctx-1',
    status: { state: 'COMPLETED', timestamp: '2026-08-01T00:00:00.000Z' },
    history: [],
    artifacts: [],
  };
}

function safeEnvironment(): NodeJS.ProcessEnv {
  return {
    A2AMESH_MCP_TENANT_ID: 'tenant-a',
    A2AMESH_MCP_AUDIENCE: 'urn:mcp:a2amesh',
    A2AMESH_MCP_CLIENT_ID: 'local-mcp-client',
    A2AMESH_MCP_SCOPES: 'a2a:agents:read,a2a:messages:send,a2a:tasks:read',
    A2AMESH_MCP_READ_APPROVAL_ID: 'read-policy-1',
    A2AMESH_MCP_SEND_APPROVAL_ID: 'send-approval-1',
    A2AMESH_MCP_ALLOWED_TOOLS: 'a2a_discover,a2a_send_message,a2a_get_task',
    A2AMESH_MCP_TIMEOUT_MS: '30000',
    A2AMESH_MCP_ALLOW_LOCALHOST: '0',
    A2AMESH_MCP_ALLOW_PRIVATE_NETWORKS: '0',
    A2AMESH_MCP_AGENTS_JSON: JSON.stringify([
      {
        id: 'researcher',
        name: 'Researcher',
        description: 'Allowlisted research agent',
        url: 'https://agent.example.com',
        tokenEnv: 'A2AMESH_RESEARCHER_TOKEN',
      },
    ]),
    A2AMESH_RESEARCHER_TOKEN: 'agent-secret-value',
  };
}

describe('standalone MCP distribution contract', () => {
  it('publishes a stable binary and server export from @a2amesh/mcp', async () => {
    const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
      bin?: Record<string, string>;
      exports?: Record<string, unknown>;
    };

    expect(packageJson.bin).toEqual({ 'a2amesh-mcp': './dist/server/cli.js' });
    expect(packageJson.exports).toHaveProperty('./server');
  });

  it('parses help without requiring runtime credentials', async () => {
    const module = await loadServerModule();

    expect(module.parseA2AMcpServerArgs(['--help'])).toEqual({ action: 'help' });
    expect(module.parseA2AMcpServerArgs(['--transport', 'stdio'])).toEqual({
      action: 'start',
      transport: 'stdio',
    });
    expect(module.renderA2AMcpServerHelp()).toContain('a2amesh-mcp');
  });

  it('resolves named credentials and rejects inline secret fields', async () => {
    const module = await loadServerModule();
    const config = module.loadA2AMcpRuntimeConfig(safeEnvironment(), { transport: 'stdio' });

    expect(config.transport).toBe('stdio');
    expect(config.bridgeOptions.agents[0]).toEqual(
      expect.objectContaining({ id: 'researcher', token: 'agent-secret-value' }),
    );
    expect(config.bridgeOptions.allowedTools).toEqual([
      'a2a_discover',
      'a2a_send_message',
      'a2a_get_task',
    ]);
    expect(config.bridgeOptions.outboundPolicy).toEqual({
      allowLocalhost: false,
      allowPrivateNetworks: false,
    });

    const unsafe = safeEnvironment();
    unsafe['A2AMESH_MCP_AGENTS_JSON'] = JSON.stringify([
      {
        id: 'unsafe',
        name: 'Unsafe',
        description: 'Inline secret fixture',
        url: 'https://agent.example.com',
        token: 'must-not-be-accepted',
      },
    ]);

    expect(() => module.loadA2AMcpRuntimeConfig(unsafe, { transport: 'stdio' })).toThrow(
      /invalid or unsafe shape/,
    );
  });

  it('exposes only the bounded A2A tool set over an in-memory MCP connection', async () => {
    const module = await loadServerModule();
    const bridge = module.createA2AMcpBridge({
      agents: [
        {
          id: 'researcher',
          name: 'Researcher',
          description: 'Allowlisted research agent',
          url: 'https://agent.example.com',
          tenantId: 'tenant-a',
        },
      ],
      expectedTenantId: 'tenant-a',
      expectedAudience: 'urn:mcp:a2amesh',
      authContext: {
        clientId: 'local-mcp-client',
        audience: 'urn:mcp:a2amesh',
        scopes: ['a2a:agents:read', 'a2a:messages:send', 'a2a:tasks:read'],
        subjectClass: 'service-account',
        tokenSource: 'stdio-process',
      },
      readApprovalId: 'read-policy-1',
      sendApprovalId: 'send-approval-1',
      operations: {
        async sendMessage() {
          return completedTask('task-send');
        },
        async getTask() {
          return completedTask('task-read');
        },
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'a2amesh-distribution-test', version: '1.0.0' });

    try {
      await bridge.server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [...module.A2A_MCP_TOOL_NAMES].sort(),
      );
    } finally {
      await client.close().catch(() => undefined);
      await bridge.server.close().catch(() => undefined);
    }
  });
});
