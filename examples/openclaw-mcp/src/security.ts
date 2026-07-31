import {
  createMcpBridgeAuditEvent,
  emitMcpBridgeAudit,
  evaluateMcpBridgeAuthorization,
  type McpBridgeSecurityPolicy,
} from '@a2amesh/mcp';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { OPENCLAW_MCP_REQUIRED_SCOPES, resolveAllowedTools } from './toolDefinitions.js';
import type { OpenClawMcpBridgeOptions, OpenClawMcpToolName } from './types.js';

export function createOpenClawBridgePolicy(
  options: OpenClawMcpBridgeOptions,
  name: OpenClawMcpToolName,
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
    requiredScopes: OPENCLAW_MCP_REQUIRED_SCOPES[name],
    consent: approvalId ? { decision: 'approved', approvalId } : { decision: 'pending' },
    ...(options.outboundPolicy ? { outboundPolicy: options.outboundPolicy } : {}),
    maxMessageLength: 32_768,
    ...(options.audit ? { audit: options.audit } : {}),
  };
}

export async function auditOpenClawInvalidInput(
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

export async function auditOpenClawAuthorization(
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

export async function auditOpenClawExecution(
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
