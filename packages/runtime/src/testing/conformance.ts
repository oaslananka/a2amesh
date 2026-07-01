import type {
  AgentCapabilities,
  AgentCard,
  MessageSendParams,
  ProtocolVersion,
  SupportedInterface,
  Task,
} from '@a2amesh/runtime';
import {
  getConformanceProfile,
  getConformanceProfileForProtocolVersion,
  summarizeConformanceProfile,
  type ConformanceProfile,
  type ConformanceProfileId,
  type ConformanceProfileRequirement,
  type ConformanceProfileSummary,
} from './profiles.js';

export const officialConformanceProtocolVersion = '1.0' as const;
export const experimentalConformanceProtocolVersions = ['1.2'] as const;
export const conformanceProtocolVersions = [
  officialConformanceProtocolVersion,
  ...experimentalConformanceProtocolVersions,
] as const;

export type ConformanceProtocolVersion = (typeof conformanceProtocolVersions)[number];
const conformanceProtocolVersionValues: readonly string[] = conformanceProtocolVersions;
const experimentalConformanceProtocolVersionValues: readonly ConformanceProtocolVersion[] =
  experimentalConformanceProtocolVersions;
export type ConformanceCaseStatus = 'pass' | 'fail' | 'skip';
export type ConformanceCapability = keyof Pick<
  AgentCapabilities,
  'streaming' | 'pushNotifications' | 'stateTransitionHistory' | 'extendedAgentCard'
>;

export interface ConformanceClient {
  resolveCard(): Promise<AgentCard>;
  sendMessage(params: MessageSendParams): Promise<Task>;
}

export interface ConformanceRunOptions {
  client: ConformanceClient;
  endpointUrl: string;
  packageVersion: string;
  protocolVersion?: ConformanceProtocolVersion | undefined;
  profile?: ConformanceProfileId | undefined;
  strict?: boolean | undefined;
  experimentalProfiles?: boolean | undefined;
}

export interface ParseConformanceProtocolVersionOptions {
  allowExperimental?: boolean;
}

export interface ConformanceCaseResult {
  id: string;
  name: string;
  required: boolean;
  status: ConformanceCaseStatus;
  durationMs: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface SkippedConformanceCapability {
  capability: ConformanceCapability;
  reason: string;
}

export interface ConformanceEndpointMetadata {
  url: string;
  protocolVersion?: ProtocolVersion;
  agentName?: string;
  agentVersion?: string;
  capabilities: Partial<Record<ConformanceCapability, boolean>>;
  supportedInterfaces: SupportedInterface[];
}

export interface ConformanceReport {
  schemaVersion: '1.0';
  generatedAt: string;
  package: {
    name: 'a2amesh';
    version: string;
  };
  protocolVersion: ConformanceProtocolVersion;
  endpoint: ConformanceEndpointMetadata;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    requiredFailed: number;
    durationMs: number;
  };
  cases: ConformanceCaseResult[];
  skippedCapabilities: SkippedConformanceCapability[];
  profile: ConformanceProfileSummary;
  coverage: ConformanceProfileRequirement[];
}

const conformanceMessages = {
  '1.0': {
    message: {
      kind: 'message',
      role: 'ROLE_USER',
      parts: [{ type: 'text', text: 'hello from a2a 1.0' }],
      messageId: 'msg-a2a-1-0-send',
      timestamp: '2026-05-24T12:00:00Z',
      contextId: 'ctx-a2a-1-0',
    },
    sessionId: 'session-a2a-1-0',
    contextId: 'ctx-a2a-1-0',
    configuration: {
      returnImmediately: false,
      historyLength: 1,
      acceptedOutputModes: ['text/plain'],
      extensions: [
        {
          uri: 'https://a2amesh.test/extensions/conformance/v1',
          version: '1.0.0',
          required: false,
        },
      ],
    },
  },
  '1.2': {
    message: {
      kind: 'message',
      role: 'ROLE_USER',
      parts: [
        { type: 'text', text: 'hello from a2a 1.2' },
        {
          type: 'data',
          data: {
            fixtureVersion: 'a2a-1.2',
            priority: 'normal',
          },
        },
      ],
      messageId: 'msg-a2a-1-2-send',
      timestamp: '2026-05-24T13:00:00+03:00',
      contextId: 'ctx-a2a-1-2',
    },
    sessionId: 'session-a2a-1-2',
    contextId: 'ctx-a2a-1-2',
    configuration: {
      returnImmediately: false,
      historyLength: 1,
      acceptedOutputModes: ['text/plain', 'application/json'],
      extensions: [
        {
          uri: 'https://a2amesh.test/extensions/conformance/v1',
          version: '1.0.0',
          required: false,
        },
      ],
    },
  },
} satisfies Record<ConformanceProtocolVersion, MessageSendParams>;

const capabilityChecks = [
  'streaming',
  'pushNotifications',
  'stateTransitionHistory',
  'extendedAgentCard',
] as const satisfies readonly ConformanceCapability[];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function supportsProtocolVersion(
  card: AgentCard,
  protocolVersion: ConformanceProtocolVersion,
): boolean {
  return (
    card.protocolVersion === protocolVersion ||
    (card.supportedInterfaces ?? []).some(
      (item) => item.protocolBinding === 'HTTP+JSON' && item.protocolVersion === protocolVersion,
    )
  );
}

function isExperimentalConformanceProtocolVersion(
  protocolVersion: ConformanceProtocolVersion,
): boolean {
  return experimentalConformanceProtocolVersionValues.includes(protocolVersion);
}

function isConformanceProtocolVersion(value: string): value is ConformanceProtocolVersion {
  return conformanceProtocolVersionValues.includes(value);
}

function resolveConformanceProfile(options: {
  profile?: ConformanceProfileId | undefined;
  protocolVersion?: ConformanceProtocolVersion | undefined;
  strict?: boolean | undefined;
}): ConformanceProfile {
  if (options.profile) {
    return getConformanceProfile(options.profile);
  }

  if (options.strict) {
    return getConformanceProfile('official-a2a-v1.0');
  }

  return getConformanceProfileForProtocolVersion(
    options.protocolVersion ?? officialConformanceProtocolVersion,
  );
}

function getEndpointMetadata(
  endpointUrl: string,
  agentCard: AgentCard | undefined,
): ConformanceEndpointMetadata {
  const capabilities = agentCard?.capabilities ?? {};
  return {
    url: endpointUrl,
    ...(agentCard?.protocolVersion ? { protocolVersion: agentCard.protocolVersion } : {}),
    ...(agentCard?.name ? { agentName: agentCard.name } : {}),
    ...(agentCard?.version ? { agentVersion: agentCard.version } : {}),
    capabilities: Object.fromEntries(
      capabilityChecks.map((capability) => [capability, Boolean(capabilities[capability])]),
    ) as Partial<Record<ConformanceCapability, boolean>>,
    supportedInterfaces: agentCard?.supportedInterfaces ?? [],
  };
}

async function runCase(
  id: string,
  name: string,
  required: boolean,
  fn: () => Promise<Record<string, unknown> | undefined>,
): Promise<ConformanceCaseResult> {
  const startedAt = performance.now();
  try {
    const metadata = await fn();
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      id,
      name,
      required,
      status: 'pass',
      durationMs,
      ...(metadata ? { metadata } : {}),
    };
  } catch (error) {
    return {
      id,
      name,
      required,
      status: 'fail',
      durationMs: Math.round(performance.now() - startedAt),
      message: messageFromError(error),
    };
  }
}

function skippedCase(
  id: string,
  name: string,
  message: string,
  metadata?: Record<string, unknown>,
): ConformanceCaseResult {
  return {
    id,
    name,
    required: false,
    status: 'skip',
    durationMs: 0,
    message,
    ...(metadata ? { metadata } : {}),
  };
}

function assertTaskShape(task: Task): Record<string, unknown> {
  if (!task.id) {
    throw new Error('message/send did not return a task id');
  }
  if (!task.status?.state) {
    throw new Error('message/send did not return a task status state');
  }
  if (task.status.state === 'FAILED' || task.status.state === 'CANCELED') {
    throw new Error(`message/send returned ${task.status.state}`);
  }

  return {
    taskId: task.id,
    taskState: task.status.state,
    artifactCount: task.artifacts?.length ?? 0,
  };
}

function summarize(cases: ConformanceCaseResult[]): ConformanceReport['summary'] {
  const failed = cases.filter((item) => item.status === 'fail').length;
  return {
    total: cases.length,
    passed: cases.filter((item) => item.status === 'pass').length,
    failed,
    skipped: cases.filter((item) => item.status === 'skip').length,
    requiredFailed: cases.filter((item) => item.required && item.status === 'fail').length,
    durationMs: cases.reduce((total, item) => total + item.durationMs, 0),
  };
}

export function parseConformanceProtocolVersion(
  value: string,
  options: ParseConformanceProtocolVersionOptions = {},
): ConformanceProtocolVersion {
  if (!isConformanceProtocolVersion(value)) {
    throw new Error('Unsupported --protocol-version value. Expected 1.0 or 1.2.');
  }

  if (isExperimentalConformanceProtocolVersion(value) && !options.allowExperimental) {
    throw new Error(
      'Protocol version 1.2 is an a2amesh experimental profile. Re-run with --experimental-profiles to opt in.',
    );
  }

  return value;
}

export function createConformanceMessageParams(
  protocolVersion: ConformanceProtocolVersion,
): MessageSendParams {
  return clone(conformanceMessages[protocolVersion]);
}

export function hasRequiredConformanceFailures(report: ConformanceReport): boolean {
  return report.summary.requiredFailed > 0;
}

export async function runConformanceSuite({
  client,
  endpointUrl,
  packageVersion,
  protocolVersion,
  profile: profileId,
  strict = false,
  experimentalProfiles = false,
}: ConformanceRunOptions): Promise<ConformanceReport> {
  const profile = resolveConformanceProfile({ profile: profileId, protocolVersion, strict });
  const resolvedProtocolVersion = profile.protocolVersion;

  if (isExperimentalConformanceProtocolVersion(resolvedProtocolVersion) && !experimentalProfiles) {
    throw new Error(
      'Protocol version 1.2 is an a2amesh experimental profile. Set experimentalProfiles to true to opt in.',
    );
  }

  if (strict && !profile.strict) {
    throw new Error(`Profile ${profile.id} is not a strict compatibility profile.`);
  }

  const cases: ConformanceCaseResult[] = [];
  const skippedCapabilities: SkippedConformanceCapability[] = [];
  let agentCard: AgentCard | undefined;

  cases.push(
    await runCase('agent-card', 'Resolve the public agent card', true, async () => {
      agentCard = await client.resolveCard();
      return {
        protocolVersion: agentCard.protocolVersion,
        agentName: agentCard.name,
        agentVersion: agentCard.version,
      };
    }),
  );

  cases.push(
    await runCase('protocol-version', 'Verify requested protocol support', true, async () => {
      if (!agentCard) {
        throw new Error('Agent card was not resolved');
      }
      if (!supportsProtocolVersion(agentCard, resolvedProtocolVersion)) {
        throw new Error(`Endpoint does not advertise protocol ${resolvedProtocolVersion}`);
      }
      return { requestedProtocolVersion: resolvedProtocolVersion, profile: profile.id };
    }),
  );

  cases.push(
    await runCase('message-send', 'Run the message/send conformance fixture', true, async () => {
      if (!agentCard) {
        throw new Error('Agent card was not resolved');
      }
      const task = await client.sendMessage(
        createConformanceMessageParams(resolvedProtocolVersion),
      );
      return assertTaskShape(task);
    }),
  );

  for (const capability of capabilityChecks) {
    if (!agentCard) {
      skippedCapabilities.push({ capability, reason: 'Agent card was not resolved' });
      cases.push(
        skippedCase(
          `capability.${capability}`,
          `Check ${capability} capability metadata`,
          'Agent card was not resolved',
        ),
      );
      continue;
    }

    if (!agentCard.capabilities?.[capability]) {
      skippedCapabilities.push({ capability, reason: 'Capability is not advertised' });
      cases.push(
        skippedCase(
          `capability.${capability}`,
          `Check ${capability} capability metadata`,
          'Capability is not advertised',
          { capability },
        ),
      );
      continue;
    }

    cases.push({
      id: `capability.${capability}`,
      name: `Check ${capability} capability metadata`,
      required: false,
      status: 'pass',
      durationMs: 0,
      metadata: { capability },
    });
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    package: {
      name: 'a2amesh',
      version: packageVersion,
    },
    protocolVersion: resolvedProtocolVersion,
    endpoint: getEndpointMetadata(endpointUrl, agentCard),
    summary: summarize(cases),
    cases,
    skippedCapabilities,
    profile: summarizeConformanceProfile(profile),
    coverage: profile.requirements.map((requirement) => ({ ...requirement })),
  };
}
