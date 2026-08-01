import { randomUUID } from 'node:crypto';
import type { evaluateMcpBridgeAuthorization } from '../McpBridgeSecurity.js';
import type { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createA2AMcpHttpAppWithFactory } from './http.js';
import {
  createDefaultA2AOperations,
  createA2ATaskSummary,
  A2ABridgeOperationError,
  redactA2AOutput,
  resolveA2AAgent,
  runBoundedA2AOperation,
} from './operations.js';
import {
  auditA2AAuthorization,
  auditA2AExecution,
  auditA2AInvalidInput,
  createA2ABridgePolicy,
} from './security.js';
import {
  A2A_MCP_TOOL_DEFINITIONS,
  parseA2AToolInput,
  registerA2AMcpTools,
  resolveAllowedTools,
} from './toolDefinitions.js';
import type {
  A2AMcpBridge,
  A2AMcpBridgeOptions,
  A2AMcpHttpOptions,
  A2AMcpToolName,
} from './types.js';

function errorResult(reasonCode: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `MCP bridge denied: ${reasonCode}` }],
    structuredContent: { error: reasonCode },
    isError: true,
  };
}

function successResult(value: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError: false,
  };
}

async function runDiscovery(
  options: A2AMcpBridgeOptions,
  input: Record<string, unknown>,
  secrets: readonly string[],
): Promise<CallToolResult> {
  const tool = A2A_MCP_TOOL_DEFINITIONS.a2a_discover;
  const policy = createA2ABridgePolicy(options, 'a2a_discover', input, randomUUID());
  let authorization: ReturnType<typeof evaluateMcpBridgeAuthorization>;
  try {
    authorization = await auditA2AAuthorization(tool, input, policy);
  } catch {
    return errorResult('mcp-audit-failed');
  }
  if (authorization.decision === 'block') return errorResult(authorization.reasonCode);

  const agents = options.agents
    .filter((agent) => agent.tenantId === options.expectedTenantId)
    .map((agent) => ({
      id: redactA2AOutput(agent.id, secrets),
      name: redactA2AOutput(agent.name, secrets),
      description: redactA2AOutput(agent.description, secrets),
    }));
  try {
    await auditA2AExecution(tool, input, policy, {
      decision: 'allow',
      outcome: 'succeeded',
      reasonCode: 'mcp-a2a-discovery-succeeded',
    });
  } catch {
    return errorResult('mcp-audit-failed');
  }
  return successResult({ agents });
}

async function runAgentTool(options: {
  bridgeOptions: A2AMcpBridgeOptions;
  name: Exclude<A2AMcpToolName, 'a2a_discover'>;
  input: Record<string, unknown>;
  signal?: AbortSignal | undefined;
  secrets: readonly string[];
}): Promise<CallToolResult> {
  const { bridgeOptions, name, input, signal, secrets } = options;
  const tool = A2A_MCP_TOOL_DEFINITIONS[name];
  const policy = createA2ABridgePolicy(bridgeOptions, name, input, randomUUID());
  let authorization: ReturnType<typeof evaluateMcpBridgeAuthorization>;
  try {
    authorization = await auditA2AAuthorization(tool, input, policy);
  } catch {
    return errorResult('mcp-audit-failed');
  }
  if (authorization.decision === 'block') return errorResult(authorization.reasonCode);

  const tenantId = String(input['tenantId']);
  const agent = resolveA2AAgent(bridgeOptions, tenantId, String(input['agentId']));
  if (!agent) {
    try {
      await auditA2AExecution(tool, input, policy, {
        decision: 'block',
        outcome: 'denied',
        reasonCode: 'mcp-agent-unavailable',
        evidencePointers: ['agent.allowlist', 'agent.tenantId'],
      });
    } catch {
      return errorResult('mcp-audit-failed');
    }
    return errorResult('mcp-agent-unavailable');
  }

  const operations = bridgeOptions.operations ?? createDefaultA2AOperations(bridgeOptions);
  const timeoutMs = Math.max(1, bridgeOptions.operationTimeoutMs ?? 30_000);
  try {
    const task = await runBoundedA2AOperation(
      (operationSignal) =>
        name === 'a2a_send_message'
          ? operations.sendMessage({
              agent,
              tenantId,
              message: String(input['message']),
              ...(typeof input['contextId'] === 'string' ? { contextId: input['contextId'] } : {}),
              signal: operationSignal,
            })
          : operations.getTask({
              agent,
              tenantId,
              taskId: String(input['taskId']),
              signal: operationSignal,
            }),
      signal,
      timeoutMs,
    );
    await auditA2AExecution(tool, input, policy, {
      decision: 'allow',
      outcome: 'succeeded',
      reasonCode:
        name === 'a2a_send_message' ? 'mcp-a2a-message-succeeded' : 'mcp-a2a-task-read-succeeded',
    });
    return successResult({ task: createA2ATaskSummary(task, secrets) });
  } catch (error: unknown) {
    const reasonCode =
      error instanceof A2ABridgeOperationError ? error.reasonCode : 'mcp-operation-failed';
    try {
      await auditA2AExecution(tool, input, policy, {
        decision: reasonCode === 'mcp-outbound-policy-denied' ? 'block' : 'allow',
        outcome: reasonCode === 'mcp-outbound-policy-denied' ? 'denied' : 'failed',
        reasonCode,
      });
    } catch {
      return errorResult('mcp-audit-failed');
    }
    return errorResult(reasonCode);
  }
}

export function createA2AMcpBridge(options: A2AMcpBridgeOptions): A2AMcpBridge {
  const tools = resolveAllowedTools(options);
  const secrets = options.agents.flatMap((agent) => (agent.token ? [agent.token] : []));
  const invoke: A2AMcpBridge['invoke'] = async (name, rawInput, signal) => {
    const input = parseA2AToolInput(name, rawInput);
    if (!input) {
      const record =
        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : {};
      const policy = createA2ABridgePolicy(
        options,
        name,
        { tenantId: typeof record['tenantId'] === 'string' ? record['tenantId'] : '' },
        randomUUID(),
      );
      try {
        await auditA2AInvalidInput(A2A_MCP_TOOL_DEFINITIONS[name], rawInput, policy);
      } catch {
        return errorResult('mcp-audit-failed');
      }
      return errorResult('mcp-invalid-tool-arguments');
    }
    return name === 'a2a_discover'
      ? runDiscovery(options, input, secrets)
      : runAgentTool({ bridgeOptions: options, name, input, signal, secrets });
  };

  const server = new McpServer(
    {
      name: options.serverName ?? 'a2amesh-mcp',
      version: options.serverVersion ?? '0.1.0',
    },
    {
      instructions:
        'Bounded A2A Mesh MCP bridge. Only configured tools, tenants, agents, and destinations are available.',
    },
  );
  registerA2AMcpTools(server, invoke, tools);
  return { server, invoke };
}

export function createA2AMcpHttpApp(
  options: A2AMcpHttpOptions,
): ReturnType<typeof createMcpExpressApp> {
  return createA2AMcpHttpAppWithFactory(options, createA2AMcpBridge);
}

export * from './types.js';
