import {
  createMcpBridgeAuditEvent,
  emitMcpBridgeAudit,
  evaluateMcpBridgeAuthorization,
  type McpBridgeSecurityPolicy,
} from '../McpBridgeSecurity.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { A2A_MCP_REQUIRED_SCOPES, resolveAllowedTools } from './toolDefinitions.js';
import type { A2AMcpBridgeOptions, A2AMcpToolName } from './types.js';

export function createA2ABridgePolicy(
  options: A2AMcpBridgeOptions,
  name: A2AMcpToolName,
  input: Record<string, unknown>,
  requestId: string,
): McpBridgeSecurityPolicy {
  const approvalId = name === 'a2a_send_message' ? options.sendApprovalId : options.readApprovalId;
  const tools = resolveAllowedTools(options);
  return {
    requestId,
    tenantId: typeof input['tenantId'] === 'string' ? input['tenantId'] : '',
    expectedTenantId: options.expectedTenantId,
    authContext: options.authContext,
    audiencePolicy: {
      expectedAudience: options.expectedAudience,
      selectedResource: options.expectedAudience,
    },
    authorityPolicy: {
      auditPolicy: {
        allowedTools: tools,
        approvalRequiredTools: ['a2a_send_message'],
      },
    },
    guardrailPolicy: {
      allowedTools: tools,
      approvalRequiredTools: ['a2a_send_message'],
      humanApprovalRequiredRisk: 'high',
      blockOnMetadataRisk: true,
    },
    requiredScopes: A2A_MCP_REQUIRED_SCOPES[name],
    consent: approvalId ? { decision: 'approved', approvalId } : { decision: 'pending' },
    ...(options.outboundPolicy ? { outboundPolicy: options.outboundPolicy } : {}),
    maxMessageLength: 32_768,
    ...(options.audit ? { audit: options.audit } : {}),
  };
}

export async function auditA2AInvalidInput(
  tool: Tool,
  input: unknown,
  policy: McpBridgeSecurityPolicy,
): Promise<void> {
  await emitMcpBridgeAudit(
    policy,
    createMcpBridgeAuditEvent({
      tool,
      input,
      policy,
      phase: 'authorization',
      decision: 'block',
      outcome: 'denied',
      reasonCode: 'mcp-invalid-tool-arguments',
      evidencePointers: ['tool.arguments'],
    }),
  );
}

export async function auditA2AAuthorization(
  tool: Tool,
  input: unknown,
  policy: McpBridgeSecurityPolicy,
): Promise<ReturnType<typeof evaluateMcpBridgeAuthorization>> {
  const authorization = evaluateMcpBridgeAuthorization(tool, input, policy);
  await emitMcpBridgeAudit(
    policy,
    createMcpBridgeAuditEvent({
      tool,
      input,
      policy,
      phase: 'authorization',
      decision: authorization.decision,
      outcome: authorization.decision === 'allow' ? 'allowed' : 'denied',
      reasonCode: authorization.reasonCode,
      evidencePointers: authorization.evidencePointers,
    }),
  );
  return authorization;
}

export async function auditA2AExecution(
  tool: Tool,
  input: unknown,
  policy: McpBridgeSecurityPolicy,
  options: {
    decision: 'allow' | 'block';
    outcome: 'denied' | 'succeeded' | 'failed';
    reasonCode: string;
    evidencePointers?: readonly string[] | undefined;
  },
): Promise<void> {
  await emitMcpBridgeAudit(
    policy,
    createMcpBridgeAuditEvent({
      tool,
      input,
      policy,
      phase: 'execution',
      decision: options.decision,
      outcome: options.outcome,
      reasonCode: options.reasonCode,
      ...(options.evidencePointers ? { evidencePointers: options.evidencePointers } : {}),
    }),
  );
}
