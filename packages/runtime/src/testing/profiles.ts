import type { ConformanceProtocolVersion } from './conformance.js';

export type ConformanceProfileId = 'official-a2a-v1.0' | 'legacy-a2amesh' | 'experimental-a2a-v1.2';

export type ConformanceProfileStatus = 'supported' | 'partial' | 'legacy-alias' | 'unsupported';

export type ConformanceProfileArea =
  | 'protocol'
  | 'methods'
  | 'fields'
  | 'states'
  | 'bindings'
  | 'streaming'
  | 'push-notifications'
  | 'agent-card'
  | 'security'
  | 'extensions'
  | 'tenancy';

export interface ConformanceProfileRequirement {
  id: string;
  area: ConformanceProfileArea;
  name: string;
  status: ConformanceProfileStatus;
  required: boolean;
  evidence: string;
  notes?: string;
  trackedBy?: string;
}

export interface ConformanceProfile {
  id: ConformanceProfileId;
  title: string;
  protocolVersion: ConformanceProtocolVersion;
  strict: boolean;
  description: string;
  sourceOfTruth: string;
  requirements: readonly ConformanceProfileRequirement[];
}

export interface ConformanceProfileSummary {
  id: ConformanceProfileId;
  title: string;
  strict: boolean;
  protocolVersion: ConformanceProtocolVersion;
  sourceOfTruth: string;
  coverage: {
    total: number;
    supported: number;
    partial: number;
    legacyAlias: number;
    unsupported: number;
    requiredUnsupported: number;
  };
}

const officialA2aV1Requirements = [
  {
    id: 'agent-card.v1-required-fields',
    area: 'agent-card',
    name: 'Agent Card v1.0 required fields and supported interfaces',
    status: 'partial',
    required: true,
    evidence:
      'AgentCard supports protocolVersion, supportedInterfaces, security, skills, and capabilities; tenant-aware interface routing is tracked separately.',
    trackedBy: '#314',
  },
  {
    id: 'binding.jsonrpc-message-send',
    area: 'methods',
    name: 'JSON-RPC message/send fixture',
    status: 'supported',
    required: true,
    evidence:
      'The conformance runner sends the message/send fixture and validates the returned task shape.',
  },
  {
    id: 'binding.http-json-rest',
    area: 'bindings',
    name: 'HTTP+JSON REST binding',
    status: 'unsupported',
    required: true,
    evidence:
      'The official proto maps SendMessage to POST /message:send and task operations to REST paths.',
    trackedBy: '#316',
  },
  {
    id: 'binding.streaming-message',
    area: 'streaming',
    name: 'message/stream or SendStreamingMessage',
    status: 'partial',
    required: false,
    evidence:
      'Streaming is capability-gated in the runner; protocol-level strict fixtures are tracked separately.',
    trackedBy: '#317',
  },
  {
    id: 'push.task-push-notification-config',
    area: 'push-notifications',
    name: 'TaskPushNotificationConfig create/get/list/delete surface',
    status: 'supported',
    required: true,
    evidence:
      'Runtime supports legacy tasks/pushNotification set/get plus official tasks/pushNotificationConfig create/get/list/delete with taskPushNotificationConfig payloads and per-config ids.',
    trackedBy: '#17',
  },
  {
    id: 'fields.send-message-configuration',
    area: 'fields',
    name: 'SendMessageConfiguration returnImmediately and historyLength',
    status: 'supported',
    required: true,
    evidence:
      'Runtime accepts canonical returnImmediately/historyLength semantics, keeps blocking as a legacy alias, trims response history, and validates invalid history limits.',
    trackedBy: '#13',
  },
  {
    id: 'states.official-task-state-enum',
    area: 'states',
    name: 'Official TaskState enum coverage',
    status: 'supported',
    required: true,
    evidence:
      'Runtime normalizes official TASK_STATE_* values, covers submitted, queued, working, input-required, auth-required, waiting-on-external, completed, failed, canceled, and rejected, and rejects terminal mutations.',
    trackedBy: '#13',
  },
  {
    id: 'extensions.headers',
    area: 'extensions',
    name: 'A2A-Version and A2A-Extensions header negotiation',
    status: 'partial',
    required: true,
    evidence:
      'Request-body extension negotiation exists; header and metadata variants are tracked separately.',
    trackedBy: '#315',
  },
  {
    id: 'tenancy.interface-tenant',
    area: 'tenancy',
    name: 'Tenant-aware interface routing',
    status: 'partial',
    required: false,
    evidence:
      'Tenant metadata exists in runtime types; strict per-interface tenant routing remains a tracked gap.',
    trackedBy: '#316',
  },
  {
    id: 'security.auth-observability',
    area: 'security',
    name: 'Security schemes, auth, and observability metadata',
    status: 'partial',
    required: false,
    evidence:
      'JWT/JWKS, request context, metrics, and tracing exist; profile-specific enterprise controls are tracked in policy and ops issues.',
    trackedBy: '#318',
  },
] as const satisfies readonly ConformanceProfileRequirement[];

const legacyA2aWarpRequirements = [
  {
    id: 'legacy.jsonrpc-paths',
    area: 'bindings',
    name: 'A2A Mesh JSON-RPC paths',
    status: 'supported',
    required: true,
    evidence: 'Legacy profile accepts /, /rpc, and /a2a/jsonrpc JSON-RPC endpoints.',
  },
  {
    id: 'legacy.blocking-configuration',
    area: 'fields',
    name: 'blocking configuration alias',
    status: 'legacy-alias',
    required: true,
    evidence: 'Legacy message configuration uses blocking instead of official returnImmediately.',
  },
  {
    id: 'legacy.push-notification-set-get',
    area: 'push-notifications',
    name: 'tasks/pushNotification set/get JSON-RPC aliases',
    status: 'legacy-alias',
    required: false,
    evidence: 'Legacy push notification methods are kept for backwards compatibility.',
  },
] as const satisfies readonly ConformanceProfileRequirement[];

const experimentalA2aV12Requirements = [
  ...officialA2aV1Requirements,
  {
    id: 'experimental.structured-data-fixture',
    area: 'protocol',
    name: 'A2A Mesh 1.2 structured data fixture',
    status: 'supported',
    required: false,
    evidence: 'Experimental profile sends a data part fixture and requires explicit opt-in.',
  },
] as const satisfies readonly ConformanceProfileRequirement[];

export const conformanceProfiles = {
  'official-a2a-v1.0': {
    id: 'official-a2a-v1.0',
    title: 'Official A2A v1.0 strict compatibility profile',
    protocolVersion: '1.0',
    strict: true,
    description:
      'Strict profile aligned to the normative A2A v1.0 protobuf and HTTP+JSON binding surface. Unsupported and legacy-alias entries are reported explicitly.',
    sourceOfTruth: 'https://a2a-protocol.org/latest/definitions/',
    requirements: officialA2aV1Requirements,
  },
  'legacy-a2amesh': {
    id: 'legacy-a2amesh',
    title: 'A2A Mesh legacy compatibility profile',
    protocolVersion: '1.0',
    strict: false,
    description:
      'Backwards-compatible profile for existing A2A Mesh JSON-RPC paths, local configuration aliases, and legacy push notification method names.',
    sourceOfTruth: 'A2A Mesh local runtime contract',
    requirements: legacyA2aWarpRequirements,
  },
  'experimental-a2a-v1.2': {
    id: 'experimental-a2a-v1.2',
    title: 'A2A Mesh experimental A2A 1.2 profile',
    protocolVersion: '1.2',
    strict: false,
    description:
      'Opt-in experimental fixture profile used to exercise future A2A Mesh behavior without weakening the official v1.0 strict profile.',
    sourceOfTruth: 'A2A Mesh experimental profile registry',
    requirements: experimentalA2aV12Requirements,
  },
} as const satisfies Record<ConformanceProfileId, ConformanceProfile>;

const profileIds = Object.keys(conformanceProfiles) as ConformanceProfileId[];
const profileIdsByProtocolVersion: Record<ConformanceProtocolVersion, ConformanceProfileId> = {
  '1.0': 'official-a2a-v1.0',
  '1.2': 'experimental-a2a-v1.2',
};

export function getConformanceProfile(id: ConformanceProfileId): ConformanceProfile {
  return conformanceProfiles[id];
}

export function getConformanceProfileForProtocolVersion(
  protocolVersion: ConformanceProtocolVersion,
): ConformanceProfile {
  return getConformanceProfile(profileIdsByProtocolVersion[protocolVersion]);
}

export function isConformanceProfileId(value: string): value is ConformanceProfileId {
  return profileIds.includes(value as ConformanceProfileId);
}

export function parseConformanceProfileId(value: string): ConformanceProfileId {
  if (!isConformanceProfileId(value)) {
    throw new Error(`Unsupported --profile value. Expected one of: ${profileIds.join(', ')}.`);
  }
  return value;
}

export function summarizeConformanceProfile(
  profile: ConformanceProfile,
): ConformanceProfileSummary {
  const unsupported = profile.requirements.filter((item) => item.status === 'unsupported');
  return {
    id: profile.id,
    title: profile.title,
    strict: profile.strict,
    protocolVersion: profile.protocolVersion,
    sourceOfTruth: profile.sourceOfTruth,
    coverage: {
      total: profile.requirements.length,
      supported: profile.requirements.filter((item) => item.status === 'supported').length,
      partial: profile.requirements.filter((item) => item.status === 'partial').length,
      legacyAlias: profile.requirements.filter((item) => item.status === 'legacy-alias').length,
      unsupported: unsupported.length,
      requiredUnsupported: unsupported.filter((item) => item.required).length,
    },
  };
}
