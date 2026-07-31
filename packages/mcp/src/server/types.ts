import type { OutboundPolicyOptions, Task } from '@a2amesh/runtime';
import type { McpAuthContext } from '../McpAuthBoundary.js';
import type { McpBridgeAuditEvent } from '../McpBridgeSecurity.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const A2A_MCP_TOOL_NAMES = ['a2a_discover', 'a2a_send_message', 'a2a_get_task'] as const;

export type A2AMcpToolName = (typeof A2A_MCP_TOOL_NAMES)[number];

export interface A2AMcpAgentConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  tenantId: string;
  token?: string | undefined;
}

export interface A2AMcpOperations {
  sendMessage(input: {
    agent: A2AMcpAgentConfig;
    tenantId: string;
    message: string;
    contextId?: string | undefined;
    signal: AbortSignal;
  }): Promise<Task>;
  getTask(input: {
    agent: A2AMcpAgentConfig;
    tenantId: string;
    taskId: string;
    signal: AbortSignal;
  }): Promise<Task>;
}

export interface A2AMcpBridgeOptions {
  agents: readonly A2AMcpAgentConfig[];
  expectedTenantId: string;
  expectedAudience: string;
  authContext: McpAuthContext;
  readApprovalId?: string | undefined;
  sendApprovalId?: string | undefined;
  allowedTools?: readonly A2AMcpToolName[] | undefined;
  operationTimeoutMs?: number | undefined;
  outboundPolicy?: OutboundPolicyOptions | undefined;
  audit?: ((event: McpBridgeAuditEvent) => void | Promise<void>) | undefined;
  operations?: A2AMcpOperations | undefined;
  serverName?: string | undefined;
  serverVersion?: string | undefined;
}

export interface A2AMcpHttpOptions extends A2AMcpBridgeOptions {
  transportToken: string;
  host?: string | undefined;
  allowedHosts?: string[] | undefined;
}

export interface A2AMcpBridge {
  server: McpServer;
  invoke(name: A2AMcpToolName, input: unknown, signal?: AbortSignal): Promise<CallToolResult>;
}
