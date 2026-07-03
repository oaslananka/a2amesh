import { createHash } from 'node:crypto';
import type { OutboundPolicyOptions } from '@a2amesh/runtime';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  createMcpSafeAuditEvent,
  decideMcpRuntimeAuthority,
  validateMcpAudience,
  type McpAudiencePolicy,
  type McpAuthContext,
  type McpRuntimeAuthorityPolicy,
} from './McpAuthBoundary.js';
import {
  createMcpGuardrailAuditEvent,
  decideMcpToolGuardrail,
  type McpToolRiskPolicy,
} from './McpToolGuardrails.js';

export type McpConsentDecision = 'approved' | 'denied' | 'pending';
export type McpBridgeDecision = 'allow' | 'block';

export interface McpBridgeSecurityPolicy {
  requestId: string;
  tenantId: string;
  expectedTenantId: string;
  authContext: McpAuthContext;
  audiencePolicy: McpAudiencePolicy;
  authorityPolicy?: McpRuntimeAuthorityPolicy | undefined;
  guardrailPolicy?: McpToolRiskPolicy | undefined;
  requiredScopes?: readonly string[] | undefined;
  consent: {
    decision: McpConsentDecision;
    approvalId?: string | undefined;
  };
  outboundPolicy?: OutboundPolicyOptions | undefined;
  maxMessageLength?: number | undefined;
  audit?: ((event: McpBridgeAuditEvent) => void | Promise<void>) | undefined;
}

export interface McpBridgeAuditEvent {
  timestamp: string;
  requestId: string;
  tenantId: string;
  authContextHash: string;
  selectedMcpTool: string;
  phase: 'authorization' | 'execution';
  decision: McpBridgeDecision;
  outcome: 'allowed' | 'denied' | 'succeeded' | 'failed';
  reasonCode: string;
  inputHash: string;
  evidencePointers: readonly string[];
}

export interface McpBridgeAuthorizationResult {
  decision: McpBridgeDecision;
  reasonCode: string;
  evidencePointers: readonly string[];
  inputHash: string;
}

function hashInput(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input ?? null))
    .digest('hex');
}

function normalizedScopes(scopes: readonly string[] | undefined): Set<string> {
  return new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean));
}

function block(
  reasonCode: string,
  evidencePointers: readonly string[],
  inputHash: string,
): McpBridgeAuthorizationResult {
  return { decision: 'block', reasonCode, evidencePointers, inputHash };
}

export function evaluateMcpBridgeAuthorization(
  tool: Tool,
  input: unknown,
  policy: McpBridgeSecurityPolicy,
): McpBridgeAuthorizationResult {
  const inputHash = hashInput(input);
  if (!policy.requestId.trim()) {
    return block('mcp-request-id-missing', ['request.requestId'], inputHash);
  }
  if (!policy.tenantId.trim() || policy.tenantId !== policy.expectedTenantId) {
    return block('mcp-tenant-mismatch', ['request.tenantId', 'policy.expectedTenantId'], inputHash);
  }
  if (!policy.authContext.subject?.trim() && !policy.authContext.clientId?.trim()) {
    return block('mcp-principal-missing', ['auth.subject', 'auth.clientId'], inputHash);
  }

  const audience = validateMcpAudience(policy.authContext, policy.audiencePolicy);
  if (audience.decision === 'block') {
    return block(audience.reasonCode, audience.evidencePointers, inputHash);
  }

  const grantedScopes = normalizedScopes(policy.authContext.scopes);
  const missingScopes = (policy.requiredScopes ?? []).filter(
    (scope) => !grantedScopes.has(scope.trim()),
  );
  if (missingScopes.length > 0) {
    return block('mcp-scope-missing', ['auth.scopes', 'policy.requiredScopes'], inputHash);
  }

  const authority = decideMcpRuntimeAuthority(tool, policy.authorityPolicy);
  if (authority.decision === 'block') {
    return block(authority.reasonCode, authority.evidencePointers, inputHash);
  }

  const guardrail = decideMcpToolGuardrail(
    tool,
    input,
    policy.guardrailPolicy ? { policy: policy.guardrailPolicy } : {},
  );
  if (guardrail.decision === 'block') {
    return block(guardrail.reasonCode, guardrail.evidencePointers, inputHash);
  }

  if (policy.consent.decision !== 'approved') {
    return block(
      policy.consent.decision === 'denied' ? 'mcp-consent-denied' : 'mcp-consent-required',
      ['consent.decision'],
      inputHash,
    );
  }
  if (!policy.consent.approvalId?.trim()) {
    return block('mcp-consent-evidence-missing', ['consent.approvalId'], inputHash);
  }

  return {
    decision: 'allow',
    reasonCode:
      authority.decision === 'review' || guardrail.decision === 'review'
        ? 'mcp-explicit-consent-accepted'
        : 'mcp-tool-authorized',
    evidencePointers: [
      ...audience.evidencePointers,
      ...authority.evidencePointers,
      ...guardrail.evidencePointers,
      'consent.approvalId',
    ],
    inputHash,
  };
}

export function createMcpBridgeAuditEvent(options: {
  tool: Tool;
  input: unknown;
  policy: McpBridgeSecurityPolicy;
  phase: McpBridgeAuditEvent['phase'];
  decision: McpBridgeDecision;
  outcome: McpBridgeAuditEvent['outcome'];
  reasonCode: string;
  evidencePointers?: readonly string[] | undefined;
}): McpBridgeAuditEvent {
  const safeAuth = createMcpSafeAuditEvent({
    requestId: options.policy.requestId,
    authContext: options.policy.authContext,
    selectedMcpServer: 'a2a-bridge',
    selectedMcpTool: options.tool.name,
    policyDecision: options.decision,
    reasonCode: options.decision === 'allow' ? 'mcp-tool-allowed' : 'mcp-tool-blocked',
    evidencePointers: options.evidencePointers,
  });
  const guardrail = createMcpGuardrailAuditEvent({
    requestId: options.policy.requestId,
    selectedMcpServer: 'a2a-bridge',
    input: options.input,
    result: decideMcpToolGuardrail(
      options.tool,
      options.input,
      options.policy.guardrailPolicy ? { policy: options.policy.guardrailPolicy } : {},
    ),
  });
  return {
    timestamp: new Date().toISOString(),
    requestId: options.policy.requestId,
    tenantId: options.policy.tenantId,
    authContextHash: safeAuth.authContextHash,
    selectedMcpTool: options.tool.name,
    phase: options.phase,
    decision: options.decision,
    outcome: options.outcome,
    reasonCode: options.reasonCode,
    inputHash: guardrail.inputHash ?? hashInput(options.input),
    evidencePointers: options.evidencePointers ?? [],
  };
}

export async function emitMcpBridgeAudit(
  policy: McpBridgeSecurityPolicy,
  event: McpBridgeAuditEvent,
): Promise<void> {
  await policy.audit?.(event);
}
