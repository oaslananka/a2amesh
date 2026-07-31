import { randomUUID } from 'node:crypto';
import type { evaluateMcpBridgeAuthorization } from '@a2amesh/mcp';
import type { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createOpenClawMcpHttpAppWithFactory } from './http.js';
import {
  createDefaultOpenClawOperations,
  createOpenClawTaskSummary,
  OpenClawBridgeOperationError,
  redactOpenClawOutput,
  resolveOpenClawAgent,
  runBoundedOpenClawOperation,
} from './operations.js';
import {
  auditOpenClawAuthorization,
  auditOpenClawExecution,
  auditOpenClawInvalidInput,
  createOpenClawBridgePolicy,
} from './security.js';
import {
  OPENCLAW_MCP_TOOL_DEFINITIONS,
  parseOpenClawToolInput,
  registerOpenClawMcpTools,
  resolveAllowedTools,
} from './toolDefinitions.js';
import type {
  OpenClawMcpBridge,
  OpenClawMcpBridgeOptions,
  OpenClawMcpHttpOptions,
  OpenClawMcpToolName,
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
  options: OpenClawMcpBridgeOptions,
  input: Record<string, unknown>,
  secrets: readonly string[],
): Promise<CallToolResult> {
  const tool = OPENCLAW_MCP_TOOL_DEFINITIONS.a2a_discover;
  const policy = createOpenClawBridgePolicy(options, 'a2a_discover', input, randomUUID());
  let authorization: ReturnType<typeof evaluateMcpBridgeAuthorization>;
  try {
    authorization = await auditOpenClawAuthorization(tool, input, policy);
  } catch {
    return errorResult('mcp-audit-failed');
  }
  if (authorization.decision === 'block') return errorResult(authorization.reasonCode);

  const agents = options.agents
    .filter((agent) => agent.tenantId === options.expectedTenantId)
    .map((agent) => ({
      id: redactOpenClawOutput(agent.id, secrets),
      name: redactOpenClawOutput(agent.name, secrets),
      description: redactOpenClawOutput(agent.description, secrets),
    }));
  try {
    await auditOpenClawExecution(tool, input, policy, {
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
  bridgeOptions: OpenClawMcpBridgeOptions;
  name: Exclude<OpenClawMcpToolName, 'a2a_discover'>;
  input: Record<string, unknown>;
  signal?: AbortSignal | undefined;
  secrets: readonly string[];
}): Promise<CallToolResult> {
  const { bridgeOptions, name, input, signal, secrets } = options;
  const tool = OPENCLAW_MCP_TOOL_DEFINITIONS[name];
  const policy = createOpenClawBridgePolicy(bridgeOptions, name, input, randomUUID());
  let authorization: ReturnType<typeof evaluateMcpBridgeAuthorization>;
  try {
    authorization = await auditOpenClawAuthorization(tool, input, policy);
  } catch {
    return errorResult('mcp-audit-failed');
  }
  if (authorization.decision === 'block') return errorResult(authorization.reasonCode);

  const tenantId = String(input['tenantId']);
  const agent = resolveOpenClawAgent(bridgeOptions, tenantId, String(input['agentId']));
  if (!agent) {
    try {
      await auditOpenClawExecution(tool, input, policy, {
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

  const operations = bridgeOptions.operations ?? createDefaultOpenClawOperations(bridgeOptions);
  const timeoutMs = Math.max(1, bridgeOptions.operationTimeoutMs ?? 30_000);
  try {
    const task = await runBoundedOpenClawOperation(
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
    await auditOpenClawExecution(tool, input, policy, {
      decision: 'allow',
      outcome: 'succeeded',
      reasonCode:
        name === 'a2a_send_message' ? 'mcp-a2a-message-succeeded' : 'mcp-a2a-task-read-succeeded',
    });
    return successResult({ task: createOpenClawTaskSummary(task, secrets) });
  } catch (error: unknown) {
    const reasonCode =
      error instanceof OpenClawBridgeOperationError ? error.reasonCode : 'mcp-operation-failed';
    try {
      await auditOpenClawExecution(tool, input, policy, {
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

export function createOpenClawMcpBridge(options: OpenClawMcpBridgeOptions): OpenClawMcpBridge {
  const tools = resolveAllowedTools(options);
  const secrets = options.agents.flatMap((agent) => (agent.token ? [agent.token] : []));
  const invoke: OpenClawMcpBridge['invoke'] = async (name, rawInput, signal) => {
    const input = parseOpenClawToolInput(name, rawInput);
    if (!input) {
      const record =
        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : {};
      const policy = createOpenClawBridgePolicy(
        options,
        name,
        { tenantId: typeof record['tenantId'] === 'string' ? record['tenantId'] : '' },
        randomUUID(),
      );
      try {
        await auditOpenClawInvalidInput(OPENCLAW_MCP_TOOL_DEFINITIONS[name], rawInput, policy);
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
      name: options.serverName ?? 'a2amesh-openclaw-mcp-compat',
      version: options.serverVersion ?? '0.1.0',
    },
    {
      instructions:
        'Bounded A2A Mesh compatibility bridge. Only configured tools, tenants, agents, and destinations are available.',
    },
  );
  registerOpenClawMcpTools(server, invoke, tools);
  return { server, invoke };
}

export function createOpenClawMcpHttpApp(
  options: OpenClawMcpHttpOptions,
): ReturnType<typeof createMcpExpressApp> {
  return createOpenClawMcpHttpAppWithFactory(options, createOpenClawMcpBridge);
}

export * from './types.js';
