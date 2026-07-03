import {
  A2AClient,
  createAuthenticatingFetchWithRetry,
  validateUrl,
  type Task,
} from '@a2amesh/runtime';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  createMcpBridgeAuditEvent,
  emitMcpBridgeAudit,
  evaluateMcpBridgeAuthorization,
  type McpBridgeSecurityPolicy,
} from './McpBridgeSecurity.js';

export interface A2AMcpToolConfig {
  /** The URL of the A2A Agent */
  agentUrl: string;
  /** Name for the exposed MCP tool */
  name: string;
  /** Description for the exposed MCP tool */
  description: string;
  /** Optional auth token to talk to the A2A Agent */
  token?: string;
  /** Optional ID for resuming sessions */
  sessionId?: string;
  /** Required execution boundary. Calls without it fail closed. */
  security?: McpBridgeSecurityPolicy;
}

function toolError(reasonCode: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `MCP bridge denied: ${reasonCode}` }],
    isError: true,
  };
}

function validateToolArguments(
  args: unknown,
  maxMessageLength: number,
): args is { message: string; contextId?: string } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const record = args as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'message' && key !== 'contextId')) return false;
  if (typeof record['message'] !== 'string') return false;
  if (!record['message'].trim() || record['message'].length > maxMessageLength) return false;
  return (
    record['contextId'] === undefined ||
    (typeof record['contextId'] === 'string' && record['contextId'].length <= 256)
  );
}

function requestUrl(input: string | URL | Request): string | URL {
  return input instanceof Request ? input.url : input;
}

/**
 * Creates an MCP-compatible Tool definition that proxies requests to an A2A Agent.
 */
export function createMcpToolFromAgent(config: A2AMcpToolConfig): Tool {
  return {
    name: config.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    description: `[A2A Agent Proxy] ${config.description}`,
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'The natural language prompt or structured JSON request to send to the underlying A2A agent.',
        },
        contextId: {
          type: 'string',
          description: 'Optional Context ID to correlate a multi-turn conversation.',
        },
      },
      required: ['message'],
    },
  };
}

/**
 * Executes the MCP tool call by forwarding it to the A2A Agent.
 */
export async function handleA2AMcpToolCall(
  config: A2AMcpToolConfig,
  args: { message: string; contextId?: string },
): Promise<CallToolResult> {
  const security = config.security;
  if (!security) return toolError('mcp-security-policy-required');
  const tool = createMcpToolFromAgent(config);
  if (!validateToolArguments(args, security.maxMessageLength ?? 32_768)) {
    const event = createMcpBridgeAuditEvent({
      tool,
      input: args,
      policy: security,
      phase: 'authorization',
      decision: 'block',
      outcome: 'denied',
      reasonCode: 'mcp-invalid-tool-arguments',
      evidencePointers: ['tool.arguments'],
    });
    await emitMcpBridgeAudit(security, event);
    return toolError(event.reasonCode);
  }

  const authorization = evaluateMcpBridgeAuthorization(tool, args, security);
  await emitMcpBridgeAudit(
    security,
    createMcpBridgeAuditEvent({
      tool,
      input: args,
      policy: security,
      phase: 'authorization',
      decision: authorization.decision,
      outcome: authorization.decision === 'allow' ? 'allowed' : 'denied',
      reasonCode: authorization.reasonCode,
      evidencePointers: authorization.evidencePointers,
    }),
  );
  if (authorization.decision === 'block') return toolError(authorization.reasonCode);

  try {
    await validateUrl(config.agentUrl, security.outboundPolicy);
  } catch {
    await emitMcpBridgeAudit(
      security,
      createMcpBridgeAuditEvent({
        tool,
        input: args,
        policy: security,
        phase: 'execution',
        decision: 'block',
        outcome: 'denied',
        reasonCode: 'mcp-outbound-policy-denied',
        evidencePointers: ['agentUrl', 'security.outboundPolicy'],
      }),
    );
    return toolError('mcp-outbound-policy-denied');
  }

  try {
    const policyFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const safeUrl = await validateUrl(requestUrl(input), security.outboundPolicy);
      return globalThis.fetch(safeUrl, { ...init, redirect: 'error' });
    };
    const fetcher = config.token
      ? createAuthenticatingFetchWithRetry(policyFetch, {
          async headers() {
            return { Authorization: `Bearer ${config.token}` };
          },
        })
      : policyFetch;

    const client = new A2AClient(config.agentUrl, { fetchImplementation: fetcher });

    const task: Task = await client.sendMessage({
      message: {
        role: 'user',
        parts: [{ type: 'text', text: args.message }],
        messageId: `mcp-bridge-${Date.now()}`,
        timestamp: new Date().toISOString(),
      },
      ...(args.contextId ? { contextId: args.contextId } : {}),
    });

    let finalOutput = '';
    if (task.artifacts && task.artifacts.length > 0) {
      finalOutput = task.artifacts
        .flatMap((a) => a.parts)
        .map((p) => {
          if (p.type === 'text') return p.text;
          if (p.type === 'data') return JSON.stringify(p.data, null, 2);
          return '[Binary File]';
        })
        .join('\\\n\\\n');
    } else {
      finalOutput = `Task generated no artifacts. Final state: ${task.status.state}`;
    }

    const result: CallToolResult = {
      content: [
        {
          type: 'text',
          text: finalOutput,
        },
      ],
      isError: task.status.state === 'FAILED',
    };
    await emitMcpBridgeAudit(
      security,
      createMcpBridgeAuditEvent({
        tool,
        input: args,
        policy: security,
        phase: 'execution',
        decision: 'allow',
        outcome: result.isError ? 'failed' : 'succeeded',
        reasonCode: result.isError ? 'mcp-a2a-task-failed' : 'mcp-a2a-call-succeeded',
      }),
    );
    return result;
  } catch {
    await emitMcpBridgeAudit(
      security,
      createMcpBridgeAuditEvent({
        tool,
        input: args,
        policy: security,
        phase: 'execution',
        decision: 'allow',
        outcome: 'failed',
        reasonCode: 'mcp-a2a-call-failed',
      }),
    );
    return toolError('mcp-a2a-call-failed');
  }
}
