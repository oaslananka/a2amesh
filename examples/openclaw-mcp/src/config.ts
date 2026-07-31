import * as z from 'zod/v4';
import {
  OPENCLAW_MCP_TOOL_NAMES,
  type OpenClawMcpAgentConfig,
  type OpenClawMcpBridgeOptions,
  type OpenClawMcpToolName,
} from './bridge.js';

export interface OpenClawMcpRuntimeConfig {
  transport: 'streamable-http' | 'stdio';
  host: string;
  port: number;
  transportToken?: string | undefined;
  bridgeOptions: OpenClawMcpBridgeOptions;
}

const agentEnvironmentSchema = z.strictObject({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(256),
  description: z.string().trim().min(1).max(1_024),
  url: z.string().trim().min(1).max(2_048),
  tokenEnv: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
});

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = optionalValue(env, name);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function commaList(env: NodeJS.ProcessEnv, name: string): string[] {
  return Array.from(
    new Set(
      requiredValue(env, name)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function parsedTransport(env: NodeJS.ProcessEnv): 'streamable-http' | 'stdio' {
  const value = optionalValue(env, 'A2AMESH_OPENCLAW_MCP_TRANSPORT') ?? 'streamable-http';
  if (value !== 'streamable-http' && value !== 'stdio') {
    throw new Error('A2AMESH_OPENCLAW_MCP_TRANSPORT must be streamable-http or stdio.');
  }
  return value;
}

function parsedHost(env: NodeJS.ProcessEnv): string {
  const value = optionalValue(env, 'A2AMESH_OPENCLAW_MCP_HOST') ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(value)) {
    throw new Error('The compatibility spike accepts loopback bindings only.');
  }
  return value;
}

function parsedPort(env: NodeJS.ProcessEnv): number {
  const value = positiveInteger(env, 'A2AMESH_OPENCLAW_MCP_PORT', 3097);
  if (value > 65_535) throw new Error('A2AMESH_OPENCLAW_MCP_PORT must be at most 65535.');
  return value;
}

function parsedAllowedTools(env: NodeJS.ProcessEnv): OpenClawMcpToolName[] {
  const configured = commaList(env, 'A2AMESH_OPENCLAW_MCP_ALLOWED_TOOLS');
  const supported = new Set<string>(OPENCLAW_MCP_TOOL_NAMES);
  if (configured.some((name) => !supported.has(name))) {
    throw new Error('The allowed tool list contains an unsupported tool name.');
  }
  if (configured.length === 0) throw new Error('At least one allowed tool is required.');
  return configured as OpenClawMcpToolName[];
}

function validatedAgentUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Agent configuration contains an invalid URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Agent URLs must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Agent URLs cannot contain credentials, query strings, or fragments.');
  }
  return url.toString().replace(/\/$/, '');
}

function parsedAgents(env: NodeJS.ProcessEnv, expectedTenantId: string): OpenClawMcpAgentConfig[] {
  let raw: unknown;
  try {
    raw = JSON.parse(requiredValue(env, 'A2AMESH_OPENCLAW_MCP_AGENTS_JSON'));
  } catch {
    throw new Error('A2AMESH_OPENCLAW_MCP_AGENTS_JSON must be valid JSON.');
  }
  const parsed = z.array(agentEnvironmentSchema).min(1).safeParse(raw);
  if (!parsed.success) {
    throw new Error('A2AMESH_OPENCLAW_MCP_AGENTS_JSON has an invalid or unsafe shape.');
  }
  const seen = new Set<string>();
  return parsed.data.map((agent) => {
    if (seen.has(agent.id)) throw new Error('Agent IDs must be unique.');
    seen.add(agent.id);
    const token = agent.tokenEnv ? optionalValue(env, agent.tokenEnv) : undefined;
    if (agent.tokenEnv && !token) {
      throw new Error(`Missing credential environment variable: ${agent.tokenEnv}`);
    }
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      url: validatedAgentUrl(agent.url),
      tenantId: expectedTenantId,
      ...(token ? { token } : {}),
    };
  });
}

export function loadOpenClawMcpRuntimeConfig(env: NodeJS.ProcessEnv): OpenClawMcpRuntimeConfig {
  const transport = parsedTransport(env);
  const host = parsedHost(env);
  const port = parsedPort(env);
  const expectedTenantId = requiredValue(env, 'A2AMESH_OPENCLAW_MCP_TENANT_ID');
  const expectedAudience = requiredValue(env, 'A2AMESH_OPENCLAW_MCP_AUDIENCE');
  const clientId = requiredValue(env, 'A2AMESH_OPENCLAW_MCP_CLIENT_ID');
  const scopes = commaList(env, 'A2AMESH_OPENCLAW_MCP_SCOPES');
  const allowedTools = parsedAllowedTools(env);
  const readApprovalId = optionalValue(env, 'A2AMESH_OPENCLAW_MCP_READ_APPROVAL_ID');
  const sendApprovalId = optionalValue(env, 'A2AMESH_OPENCLAW_MCP_SEND_APPROVAL_ID');

  if (
    allowedTools.some((tool) => tool === 'a2a_discover' || tool === 'a2a_get_task') &&
    !readApprovalId
  ) {
    throw new Error('A2AMESH_OPENCLAW_MCP_READ_APPROVAL_ID is required for read tools.');
  }
  if (allowedTools.includes('a2a_send_message') && !sendApprovalId) {
    throw new Error('A2AMESH_OPENCLAW_MCP_SEND_APPROVAL_ID is required for a2a_send_message.');
  }

  const operationTimeoutMs = positiveInteger(env, 'A2AMESH_OPENCLAW_MCP_TIMEOUT_MS', 30_000);
  const bridgeOptions: OpenClawMcpBridgeOptions = {
    agents: parsedAgents(env, expectedTenantId),
    expectedTenantId,
    expectedAudience,
    authContext: {
      subjectClass: 'service-account',
      audience: expectedAudience,
      clientId,
      scopes,
      tokenSource: transport === 'streamable-http' ? 'authorization-header' : 'stdio-process',
    },
    allowedTools,
    operationTimeoutMs,
    ...(readApprovalId ? { readApprovalId } : {}),
    ...(sendApprovalId ? { sendApprovalId } : {}),
  };

  if (transport === 'stdio') return { transport, host, port, bridgeOptions };
  return {
    transport,
    host,
    port,
    transportToken: requiredValue(env, 'A2AMESH_OPENCLAW_MCP_SERVER_TOKEN'),
    bridgeOptions,
  };
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
