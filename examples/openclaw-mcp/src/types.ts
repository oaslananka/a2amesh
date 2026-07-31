import type { OutboundPolicyOptions, Task } from '@a2amesh/runtime';
import type { McpAuthContext, McpBridgeAuditEvent } from '@a2amesh/mcp';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const OPENCLAW_MCP_TOOL_NAMES = [
  'a2a_discover',
  'a2a_send_message',
  'a2a_get_task',
] as const;

export type OpenClawMcpToolName = (typeof OPENCLAW_MCP_TOOL_NAMES)[number];

export interface OpenClawMcpAgentConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  tenantId: string;
  token?: string | undefined;
}

export interface OpenClawMcpOperations {
  sendMessage(input: {
    agent: OpenClawMcpAgentConfig;
    tenantId: string;
    message: string;
    contextId?: string | undefined;
    signal: AbortSignal;
  }): Promise<Task>;
  getTask(input: {
    agent: OpenClawMcpAgentConfig;
    tenantId: string;
    taskId: string;
    signal: AbortSignal;
  }): Promise<Task>;
}

export interface OpenClawMcpBridgeOptions {
  agents: readonly OpenClawMcpAgentConfig[];
  expectedTenantId: string;
  expectedAudience: string;
  authContext: McpAuthContext;
  readApprovalId?: string | undefined;
  sendApprovalId?: string | undefined;
  allowedTools?: readonly OpenClawMcpToolName[] | undefined;
  operationTimeoutMs?: number | undefined;
  outboundPolicy?: OutboundPolicyOptions | undefined;
  audit?: ((event: McpBridgeAuditEvent) => void | Promise<void>) | undefined;
  operations?: OpenClawMcpOperations | undefined;
  serverName?: string | undefined;
  serverVersion?: string | undefined;
}

export interface OpenClawMcpHttpOptions extends OpenClawMcpBridgeOptions {
  transportToken: string;
  host?: string | undefined;
  allowedHosts?: string[] | undefined;
}

export interface OpenClawMcpBridge {
  server: McpServer;
  invoke(name: OpenClawMcpToolName, input: unknown, signal?: AbortSignal): Promise<CallToolResult>;
}
