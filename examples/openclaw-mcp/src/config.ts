import {
  loadA2AMcpRuntimeConfig,
  type A2AMcpRuntimeConfig,
  type A2AMcpRuntimeOverrides,
} from '@a2amesh/mcp/server';

export type OpenClawMcpRuntimeConfig = A2AMcpRuntimeConfig;

const legacyNames: ReadonlyArray<readonly [string, string]> = [
  ['A2AMESH_OPENCLAW_MCP_TRANSPORT', 'A2AMESH_MCP_TRANSPORT'],
  ['A2AMESH_OPENCLAW_MCP_HOST', 'A2AMESH_MCP_HOST'],
  ['A2AMESH_OPENCLAW_MCP_PORT', 'A2AMESH_MCP_PORT'],
  ['A2AMESH_OPENCLAW_MCP_SERVER_TOKEN', 'A2AMESH_MCP_SERVER_TOKEN'],
  ['A2AMESH_OPENCLAW_MCP_TENANT_ID', 'A2AMESH_MCP_TENANT_ID'],
  ['A2AMESH_OPENCLAW_MCP_AUDIENCE', 'A2AMESH_MCP_AUDIENCE'],
  ['A2AMESH_OPENCLAW_MCP_CLIENT_ID', 'A2AMESH_MCP_CLIENT_ID'],
  ['A2AMESH_OPENCLAW_MCP_SCOPES', 'A2AMESH_MCP_SCOPES'],
  ['A2AMESH_OPENCLAW_MCP_READ_APPROVAL_ID', 'A2AMESH_MCP_READ_APPROVAL_ID'],
  ['A2AMESH_OPENCLAW_MCP_SEND_APPROVAL_ID', 'A2AMESH_MCP_SEND_APPROVAL_ID'],
  ['A2AMESH_OPENCLAW_MCP_TIMEOUT_MS', 'A2AMESH_MCP_TIMEOUT_MS'],
  ['A2AMESH_OPENCLAW_MCP_ALLOWED_TOOLS', 'A2AMESH_MCP_ALLOWED_TOOLS'],
  ['A2AMESH_OPENCLAW_MCP_AGENTS_JSON', 'A2AMESH_MCP_AGENTS_JSON'],
];

function normalizeLegacyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const normalized = { ...env };
  for (const [legacy, current] of legacyNames) {
    if (normalized[current] === undefined && normalized[legacy] !== undefined) {
      normalized[current] = normalized[legacy];
    }
  }
  return normalized;
}

export function loadOpenClawMcpRuntimeConfig(
  env: NodeJS.ProcessEnv,
  overrides: A2AMcpRuntimeOverrides = {},
): OpenClawMcpRuntimeConfig {
  return loadA2AMcpRuntimeConfig(normalizeLegacyEnvironment(env), overrides);
}

export function createOpenClawProbeCommands(serverName: string): string[][] {
  const normalized = serverName.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error('OpenClaw MCP server name is invalid.');
  }
  return [
    ['mcp', 'status', '--verbose'],
    ['mcp', 'doctor', normalized, '--probe', '--json'],
    ['mcp', 'probe', normalized, '--json'],
  ];
}
