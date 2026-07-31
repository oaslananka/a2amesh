import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import {
  OPENCLAW_MCP_TOOL_NAMES,
  type OpenClawMcpBridge,
  type OpenClawMcpBridgeOptions,
  type OpenClawMcpToolName,
} from './types.js';

const discoverInput = z.strictObject({ tenantId: z.string().trim().min(1).max(128) });
const sendInput = z.strictObject({
  tenantId: z.string().trim().min(1).max(128),
  agentId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(32_768),
  contextId: z.string().trim().min(1).max(256).optional(),
});
const getTaskInput = z.strictObject({
  tenantId: z.string().trim().min(1).max(128),
  agentId: z.string().trim().min(1).max(128),
  taskId: z.string().trim().min(1).max(256),
});

const agentSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
const taskSummarySchema = z.strictObject({
  id: z.string(),
  state: z.string(),
  contextId: z.string().optional(),
  output: z.string(),
});

export const OPENCLAW_MCP_TOOL_DEFINITIONS: Record<OpenClawMcpToolName, Tool> = {
  a2a_discover: {
    name: 'a2a_discover',
    description: 'List the configured A2A agents available to this bounded MCP bridge.',
    inputSchema: {
      type: 'object',
      properties: { tenantId: { type: 'string' } },
      required: ['tenantId'],
      additionalProperties: false,
    },
  },
  a2a_send_message: {
    name: 'a2a_send_message',
    description: 'Send one approved message to an allowlisted A2A agent.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        agentId: { type: 'string' },
        message: { type: 'string' },
        contextId: { type: 'string' },
      },
      required: ['tenantId', 'agentId', 'message'],
      additionalProperties: false,
    },
  },
  a2a_get_task: {
    name: 'a2a_get_task',
    description: 'Read one existing task from an allowlisted A2A agent.',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        agentId: { type: 'string' },
        taskId: { type: 'string' },
      },
      required: ['tenantId', 'agentId', 'taskId'],
      additionalProperties: false,
    },
  },
};

export const OPENCLAW_MCP_REQUIRED_SCOPES: Record<OpenClawMcpToolName, readonly string[]> = {
  a2a_discover: ['a2a:agents:read'],
  a2a_send_message: ['a2a:messages:send'],
  a2a_get_task: ['a2a:tasks:read'],
};

function isOpenClawMcpToolName(value: string): value is OpenClawMcpToolName {
  return (OPENCLAW_MCP_TOOL_NAMES as readonly string[]).includes(value);
}

export function resolveAllowedTools(
  options: OpenClawMcpBridgeOptions,
): readonly OpenClawMcpToolName[] {
  const configured = options.allowedTools ?? OPENCLAW_MCP_TOOL_NAMES;
  return Array.from(new Set(configured.filter((name) => isOpenClawMcpToolName(name))));
}

export function parseOpenClawToolInput(
  name: OpenClawMcpToolName,
  input: unknown,
): Record<string, unknown> | undefined {
  const schemaByName = {
    a2a_discover: discoverInput,
    a2a_send_message: sendInput,
    a2a_get_task: getTaskInput,
  } as const;
  const parsed = schemaByName[name].safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export function registerOpenClawMcpTools(
  server: McpServer,
  invoke: OpenClawMcpBridge['invoke'],
  tools: readonly OpenClawMcpToolName[],
): void {
  if (tools.includes('a2a_discover')) {
    server.registerTool(
      'a2a_discover',
      {
        description: OPENCLAW_MCP_TOOL_DEFINITIONS.a2a_discover.description ?? '',
        inputSchema: discoverInput.shape,
        outputSchema: { agents: z.array(agentSummarySchema) },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input, extra) => invoke('a2a_discover', input, extra.signal),
    );
  }
  if (tools.includes('a2a_send_message')) {
    server.registerTool(
      'a2a_send_message',
      {
        description: OPENCLAW_MCP_TOOL_DEFINITIONS.a2a_send_message.description ?? '',
        inputSchema: sendInput.shape,
        outputSchema: { task: taskSummarySchema },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      (input, extra) => invoke('a2a_send_message', input, extra.signal),
    );
  }
  if (tools.includes('a2a_get_task')) {
    server.registerTool(
      'a2a_get_task',
      {
        description: OPENCLAW_MCP_TOOL_DEFINITIONS.a2a_get_task.description ?? '',
        inputSchema: getTaskInput.shape,
        outputSchema: { task: taskSummarySchema },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      (input, extra) => invoke('a2a_get_task', input, extra.signal),
    );
  }
}
