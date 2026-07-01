import { createHash } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  auditMcpTool,
  decideMcpToolApproval,
  type McpApprovalDecision,
  type McpAuditFinding,
  type McpAuditPolicy,
  type McpAuditSeverity,
} from './McpAudit.js';

export type McpGuardrailMode = 'execute' | 'dry-run';
export type McpGuardrailDecision = McpApprovalDecision;
export type McpGuardrailReasonCode =
  | 'mcp-tool-approved'
  | 'mcp-tool-needs-human-approval'
  | 'mcp-tool-blocked-by-policy'
  | 'mcp-dry-run-required'
  | 'mcp-metadata-risk-detected';

export interface McpToolRiskPolicy extends McpAuditPolicy {
  dryRunRequiredTools?: readonly string[] | undefined;
  humanApprovalRequiredRisk?: McpAuditSeverity | undefined;
  blockOnMetadataRisk?: boolean | undefined;
}

export interface McpRiskFinding extends McpAuditFinding {
  category: 'policy' | 'metadata' | 'side-effect' | 'schema' | 'description';
}

export interface McpToolRiskClassification {
  toolName: string;
  risk: McpAuditSeverity;
  riskScore: number;
  findings: readonly McpRiskFinding[];
}

export interface McpDryRunPlan {
  mode: 'dry-run';
  toolName: string;
  inputHash: string;
  inputPreview: Record<string, unknown>;
  wouldRequireHumanApproval: boolean;
  wouldExecute: boolean;
  evidencePointers: readonly string[];
}

export interface McpGuardrailDecisionResult {
  decision: McpGuardrailDecision;
  reasonCode: McpGuardrailReasonCode;
  toolName: string;
  risk: McpToolRiskClassification;
  requiresHumanApproval: boolean;
  dryRun?: McpDryRunPlan | undefined;
  evidencePointers: readonly string[];
}

export interface McpGuardrailAuditEvent {
  requestId: string;
  mode: McpGuardrailMode;
  selectedMcpServer?: string | undefined;
  selectedMcpTool: string;
  decision: McpGuardrailDecision;
  reasonCode: McpGuardrailReasonCode;
  risk: McpAuditSeverity;
  riskScore: number;
  requiresHumanApproval: boolean;
  inputHash?: string | undefined;
  evidencePointers: readonly string[];
  findingIds: readonly string[];
}

export interface McpToolManifestSubject {
  name: string;
  description?: string | undefined;
  tags?: readonly string[] | undefined;
  examples?: readonly string[] | undefined;
  inputSchema?: unknown;
}

const METADATA_RISK_PATTERNS = [
  'ignore previous',
  'system message',
  'hidden instruction',
  'prompt injection',
  'override approval',
] as const;

const SIDE_EFFECT_PATTERNS = ['delete', 'write', 'modify', 'payment', 'browser', 'network'] as const;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function includesName(values: readonly string[] | undefined, name: string): boolean {
  const normalized = normalizeName(name);
  return Boolean(values?.some((value) => normalizeName(value) === normalized));
}

function severityRank(severity: McpAuditSeverity): number {
  return { low: 1, medium: 2, high: 3 }[severity];
}

function severityAtLeast(severity: McpAuditSeverity, threshold: McpAuditSeverity): boolean {
  return severityRank(severity) >= severityRank(threshold);
}

function highestSeverity(findings: readonly McpRiskFinding[]): McpAuditSeverity {
  return findings.reduce<McpAuditSeverity>(
    (current, finding) =>
      severityRank(finding.severity) > severityRank(current) ? finding.severity : current,
    'low',
  );
}

function severityScore(severity: McpAuditSeverity): number {
  return { low: 10, medium: 40, high: 80 }[severity];
}

function openSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return true;
  const record = schema as Record<string, unknown>;
  return record['type'] === 'object' && !('properties' in record);
}

function textValues(subject: McpToolManifestSubject): Array<{ pointer: string; value: string }> {
  const fields: Array<{ pointer: string; value: string }> = [
    { pointer: 'tool.name', value: subject.name },
    { pointer: 'tool.description', value: subject.description ?? '' },
  ];
  for (const [index, tag] of (subject.tags ?? []).entries()) fields.push({ pointer: `tool.tags.${index}`, value: tag });
  for (const [index, example] of (subject.examples ?? []).entries()) {
    fields.push({ pointer: `tool.examples.${index}`, value: example });
  }
  return fields;
}

function mappedAuditFinding(finding: McpAuditFinding): McpRiskFinding {
  const category: McpRiskFinding['category'] =
    finding.id === 'open-input-schema'
      ? 'schema'
      : finding.id === 'sensitive-keyword'
        ? 'side-effect'
        : finding.id === 'long-description'
          ? 'description'
          : 'policy';
  return { ...finding, category };
}

export function classifyMcpToolManifestRisk(
  subject: McpToolManifestSubject,
  policy: McpToolRiskPolicy = {},
): McpToolRiskClassification {
  const findings: McpRiskFinding[] = [];
  const tool: Tool = {
    name: subject.name,
    description: subject.description,
    inputSchema:
      subject.inputSchema && typeof subject.inputSchema === 'object'
        ? (subject.inputSchema as Tool['inputSchema'])
        : { type: 'object' },
  };

  findings.push(...auditMcpTool(tool, policy).findings.map(mappedAuditFinding));

  for (const field of textValues(subject)) {
    const lower = field.value.toLowerCase();
    for (const pattern of METADATA_RISK_PATTERNS) {
      if (lower.includes(pattern)) {
        findings.push({
          id: 'metadata-risk-pattern',
          severity: 'high',
          category: 'metadata',
          message: `${field.pointer} contains metadata risk pattern ${pattern}.`,
        });
      }
    }
    for (const pattern of SIDE_EFFECT_PATTERNS) {
      if (lower.includes(pattern)) {
        findings.push({
          id: 'side-effect-pattern',
          severity: 'medium',
          category: 'side-effect',
          message: `${field.pointer} mentions side-effect capability ${pattern}.`,
        });
      }
    }
  }

  if (openSchema(subject.inputSchema)) {
    findings.push({
      id: 'open-manifest-input-schema',
      severity: 'medium',
      category: 'schema',
      message: 'Tool or skill metadata has a broad input schema.',
    });
  }

  const risk = highestSeverity(findings);
  const riskScore = Math.min(100, findings.reduce((sum, finding) => sum + severityScore(finding.severity), 0));
  return { toolName: subject.name, risk, riskScore, findings };
}
function inputHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
}

function inputPreview(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { kind: typeof input };
  }
  const preview: Record<string, unknown> = {};
  for (const key of Object.keys(input as Record<string, unknown>).slice(0, 8)) {
    const value = (input as Record<string, unknown>)[key];
    preview[key] = value === null ? null : Array.isArray(value) ? 'array' : typeof value;
  }
  return preview;
}

function evidencePointers(findings: readonly McpRiskFinding[]): string[] {
  return findings.map((finding) => `mcp.guardrails.${finding.category}.${finding.id}`);
}

export function createMcpDryRunPlan(
  tool: Tool,
  input: unknown,
  risk: McpToolRiskClassification,
  requiresHumanApproval: boolean,
): McpDryRunPlan {
  return {
    mode: 'dry-run',
    toolName: tool.name,
    inputHash: inputHash(input),
    inputPreview: inputPreview(input),
    wouldRequireHumanApproval: requiresHumanApproval,
    wouldExecute: false,
    evidencePointers: evidencePointers(risk.findings),
  };
}

export function decideMcpToolGuardrail(
  tool: Tool,
  input: unknown,
  options: { mode?: McpGuardrailMode; policy?: McpToolRiskPolicy } = {},
): McpGuardrailDecisionResult {
  const mode = options.mode ?? 'execute';
  const policy = options.policy ?? {};
  const risk = classifyMcpToolManifestRisk(
    { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
    policy,
  );
  const approval = decideMcpToolApproval(tool, policy);
  const metadataRisk = risk.findings.some((finding) => finding.id === 'metadata-risk-pattern');
  const dryRunRequired = includesName(policy.dryRunRequiredTools, tool.name);
  const requiresHumanApproval =
    approval.decision === 'review' || severityAtLeast(risk.risk, policy.humanApprovalRequiredRisk ?? 'medium');

  let decision: McpGuardrailDecision = approval.decision;
  let reasonCode: McpGuardrailReasonCode =
    decision === 'allow' ? 'mcp-tool-approved' : 'mcp-tool-needs-human-approval';

  if (approval.decision === 'block') {
    decision = 'block';
    reasonCode = 'mcp-tool-blocked-by-policy';
  } else if (metadataRisk && policy.blockOnMetadataRisk !== false) {
    decision = 'block';
    reasonCode = 'mcp-metadata-risk-detected';
  } else if (dryRunRequired && mode !== 'dry-run') {
    decision = 'review';
    reasonCode = 'mcp-dry-run-required';
  } else if (requiresHumanApproval) {
    decision = 'review';
    reasonCode = 'mcp-tool-needs-human-approval';
  }

  const dryRun = mode === 'dry-run' || dryRunRequired ? createMcpDryRunPlan(tool, input, risk, requiresHumanApproval) : undefined;
  return {
    decision,
    reasonCode,
    toolName: tool.name,
    risk,
    requiresHumanApproval,
    dryRun,
    evidencePointers: evidencePointers(risk.findings),
  };
}

export function createMcpGuardrailAuditEvent(options: {
  requestId: string;
  selectedMcpServer?: string | undefined;
  input?: unknown;
  result: McpGuardrailDecisionResult;
}): McpGuardrailAuditEvent {
  return {
    requestId: options.requestId,
    mode: options.result.dryRun ? 'dry-run' : 'execute',
    selectedMcpServer: options.selectedMcpServer,
    selectedMcpTool: options.result.toolName,
    decision: options.result.decision,
    reasonCode: options.result.reasonCode,
    risk: options.result.risk.risk,
    riskScore: options.result.risk.riskScore,
    requiresHumanApproval: options.result.requiresHumanApproval,
    inputHash: options.input === undefined ? options.result.dryRun?.inputHash : inputHash(options.input),
    evidencePointers: options.result.evidencePointers,
    findingIds: options.result.risk.findings.map((finding) => finding.id),
  };
}
