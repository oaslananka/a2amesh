import { createHash } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  decideMcpToolApproval,
  type McpAuditPolicy,
  type McpApprovalDecision,
} from './McpAudit.js';

export type McpAudienceValidationDecision = 'allow' | 'block';

export type McpAuthReasonCode =
  | 'mcp-audience-accepted'
  | 'mcp-audience-missing'
  | 'mcp-audience-mismatch'
  | 'mcp-audience-ambiguous'
  | 'mcp-selected-resource-mismatch'
  | 'mcp-tool-allowed'
  | 'mcp-tool-review-required'
  | 'mcp-tool-blocked';

export interface McpAuthContext {
  issuer?: string | undefined;
  subject?: string | undefined;
  subjectClass?: string | undefined;
  audience?: string | readonly string[] | undefined;
  clientId?: string | undefined;
  scopes?: readonly string[] | undefined;
  tokenSource?: string | undefined;
}

export interface McpAudiencePolicy {
  expectedAudience: string | readonly string[];
  selectedResource?: string | undefined;
}

export interface McpAudienceValidationResult {
  decision: McpAudienceValidationDecision;
  reasonCode: McpAuthReasonCode;
  selectedAudience?: string | undefined;
  matchedAudiences: readonly string[];
  normalizedAudiences: readonly string[];
  context: McpAuthContext;
  evidencePointers: readonly string[];
}

export interface McpRuntimeAuthorityPolicy {
  auditPolicy?: McpAuditPolicy | undefined;
}

export interface McpRuntimeAuthorityDecision {
  decision: McpApprovalDecision;
  reasonCode: McpAuthReasonCode;
  selectedTool: string;
  evidencePointers: readonly string[];
}

export interface McpSafeAuditEvent {
  requestId: string;
  authContextHash: string;
  issuer?: string | undefined;
  subjectClass?: string | undefined;
  audience?: string | readonly string[] | undefined;
  clientId?: string | undefined;
  scopes: readonly string[];
  tokenSource?: string | undefined;
  selectedMcpServer?: string | undefined;
  selectedMcpTool?: string | undefined;
  policyDecision: McpAudienceValidationDecision | McpApprovalDecision;
  reasonCode: McpAuthReasonCode;
  evidencePointers: readonly string[];
}

function normalizeList(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));
}

function normalizedScopes(scopes: readonly string[] | undefined): string[] {
  return Array.from(new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean))).sort();
}

function stableAuthContext(context: McpAuthContext): Record<string, unknown> {
  return {
    issuer: context.issuer,
    subjectClass: context.subjectClass,
    audience: normalizeList(context.audience).sort(),
    clientId: context.clientId,
    scopes: normalizedScopes(context.scopes),
    tokenSource: context.tokenSource,
  };
}

export function hashMcpAuthContext(context: McpAuthContext): string {
  return createHash('sha256')
    .update(JSON.stringify(stableAuthContext(context)))
    .digest('hex');
}

export function validateMcpAudience(
  context: McpAuthContext,
  policy: McpAudiencePolicy,
): McpAudienceValidationResult {
  const normalizedAudiences = normalizeList(context.audience);
  const expectedAudiences = normalizeList(policy.expectedAudience);
  const matchedAudiences = normalizedAudiences.filter((audience) =>
    expectedAudiences.includes(audience),
  );

  if (normalizedAudiences.length === 0) {
    return {
      decision: 'block',
      reasonCode: 'mcp-audience-missing',
      matchedAudiences,
      normalizedAudiences,
      context,
      evidencePointers: ['claims.audience'],
    };
  }

  if (matchedAudiences.length === 0) {
    return {
      decision: 'block',
      reasonCode: 'mcp-audience-mismatch',
      matchedAudiences,
      normalizedAudiences,
      context,
      evidencePointers: ['claims.audience', 'policy.expectedAudience'],
    };
  }

  if (policy.selectedResource !== undefined) {
    const selectedResource = policy.selectedResource.trim();
    if (!matchedAudiences.includes(selectedResource)) {
      return {
        decision: 'block',
        reasonCode: 'mcp-selected-resource-mismatch',
        matchedAudiences,
        normalizedAudiences,
        context,
        evidencePointers: ['claims.audience', 'request.selectedResource'],
      };
    }
    return {
      decision: 'allow',
      reasonCode: 'mcp-audience-accepted',
      selectedAudience: selectedResource,
      matchedAudiences,
      normalizedAudiences,
      context,
      evidencePointers: ['claims.audience', 'request.selectedResource'],
    };
  }

  if (normalizedAudiences.length > 1) {
    return {
      decision: 'block',
      reasonCode: 'mcp-audience-ambiguous',
      matchedAudiences,
      normalizedAudiences,
      context,
      evidencePointers: ['claims.audience', 'request.selectedResource'],
    };
  }

  return {
    decision: 'allow',
    reasonCode: 'mcp-audience-accepted',
    selectedAudience: matchedAudiences[0],
    matchedAudiences,
    normalizedAudiences,
    context,
    evidencePointers: ['claims.audience'],
  };
}

export function decideMcpRuntimeAuthority(
  tool: Tool,
  policy: McpRuntimeAuthorityPolicy = {},
): McpRuntimeAuthorityDecision {
  const approval = decideMcpToolApproval(tool, policy.auditPolicy);
  const reasonCode: McpAuthReasonCode =
    approval.decision === 'allow'
      ? 'mcp-tool-allowed'
      : approval.decision === 'review'
        ? 'mcp-tool-review-required'
        : 'mcp-tool-blocked';
  return {
    decision: approval.decision,
    reasonCode,
    selectedTool: tool.name,
    evidencePointers: approval.findings.map((finding) => `tool.findings.${finding.id}`),
  };
}

export function createMcpSafeAuditEvent(options: {
  requestId: string;
  authContext: McpAuthContext;
  selectedMcpServer?: string | undefined;
  selectedMcpTool?: string | undefined;
  policyDecision: McpAudienceValidationDecision | McpApprovalDecision;
  reasonCode: McpAuthReasonCode;
  evidencePointers?: readonly string[] | undefined;
}): McpSafeAuditEvent {
  return {
    requestId: options.requestId,
    authContextHash: hashMcpAuthContext(options.authContext),
    issuer: options.authContext.issuer,
    subjectClass: options.authContext.subjectClass,
    audience: normalizeList(options.authContext.audience),
    clientId: options.authContext.clientId,
    scopes: normalizedScopes(options.authContext.scopes),
    tokenSource: options.authContext.tokenSource,
    selectedMcpServer: options.selectedMcpServer,
    selectedMcpTool: options.selectedMcpTool,
    policyDecision: options.policyDecision,
    reasonCode: options.reasonCode,
    evidencePointers: options.evidencePointers ?? [],
  };
}
