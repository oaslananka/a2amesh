import type { AgentCard, SupportedInterface } from '../types/agent-card.js';
import { verifyAgentCard, type VerificationKey } from '../security/AgentCardSigner.js';

const A2A_SUPPORTED_PROTOCOL_VERSIONS = ['1.0'] as const;
const A2A_EXPERIMENTAL_PROTOCOL_VERSIONS = ['1.2'] as const;

export type A2AOfficialProtocolVersion = (typeof A2A_SUPPORTED_PROTOCOL_VERSIONS)[number];
export type A2AExperimentalProtocolVersion = (typeof A2A_EXPERIMENTAL_PROTOCOL_VERSIONS)[number];
export type A2AProtocolVersion = A2AOfficialProtocolVersion | A2AExperimentalProtocolVersion;

export interface A2AProtocolPreferenceOptions {
  preferredProtocolVersion?: A2AProtocolVersion;
  allowExperimentalProtocolVersions?: boolean;
}

export interface A2AAgentCardVerificationOptions {
  trustedVerificationKeys?: VerificationKey[];
  requireVerifiedAgentCard?: boolean;
}

export interface ResolveA2AAgentCardOptions {
  baseUrl: string;
  cardPath: string;
  headers: Record<string, string>;
  fetchWithRetry: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>;
  verifyCard: (card: AgentCard) => Promise<void> | void;
}

export function getA2AProtocolPreferences(
  options: A2AProtocolPreferenceOptions,
): readonly A2AProtocolVersion[] {
  const officialVersions: readonly A2AProtocolVersion[] = A2A_SUPPORTED_PROTOCOL_VERSIONS;
  const experimentalVersions: readonly A2AProtocolVersion[] =
    options.allowExperimentalProtocolVersions ? A2A_EXPERIMENTAL_PROTOCOL_VERSIONS : [];
  const preferences = [...officialVersions, ...experimentalVersions];

  if (!options.preferredProtocolVersion) {
    return preferences;
  }

  if (
    isExperimentalProtocolVersion(options.preferredProtocolVersion) &&
    !options.allowExperimentalProtocolVersions
  ) {
    throw new Error(
      'Protocol version 1.2 is an a2amesh experimental profile. Set allowExperimentalProtocolVersions to true to opt in.',
    );
  }

  if (!preferences.includes(options.preferredProtocolVersion)) {
    throw new Error(`Unsupported preferred protocol version: ${options.preferredProtocolVersion}`);
  }

  return [
    options.preferredProtocolVersion,
    ...preferences.filter((version) => version !== options.preferredProtocolVersion),
  ];
}

export function selectA2AAgentInterface(
  card: AgentCard,
  options: A2AProtocolPreferenceOptions,
): SupportedInterface | undefined {
  const interfaces = card.supportedInterfaces ?? [];

  for (const protocolVersion of getA2AProtocolPreferences(options)) {
    const selectedInterface = interfaces.find((item) => item.protocolVersion === protocolVersion);
    if (selectedInterface) {
      return selectedInterface;
    }
  }

  return undefined;
}

export function createA2AProtocolHeaders(
  headers: Record<string, string> = {},
  protocolVersion: A2AProtocolVersion = '1.0',
): Record<string, string> {
  return { ...headers, 'A2A-Version': protocolVersion };
}

export async function fetchA2AAgentCard(
  agentCardUrl: string,
  fetchImplementation: typeof fetch,
  headers: Record<string, string>,
  verifyCard: (card: AgentCard) => Promise<void> | void,
): Promise<AgentCard> {
  const response = await fetchImplementation(agentCardUrl, { headers });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Failed to resolve agent card from ${agentCardUrl}`);
  }

  const card = (await response.json()) as AgentCard;
  await verifyCard(card);
  return card;
}

export async function resolveA2AAgentCard(options: ResolveA2AAgentCardOptions): Promise<AgentCard> {
  const canonicalUrl = new URL(options.cardPath, options.baseUrl).toString();
  const legacyUrl = new URL('/.well-known/agent.json', options.baseUrl).toString();

  const response = await options.fetchWithRetry(canonicalUrl, { headers: options.headers });
  if (response.ok) {
    const card = (await response.json()) as AgentCard;
    await options.verifyCard(card);
    return card;
  }

  await response.body?.cancel().catch(() => undefined);

  const legacyResponse = await options.fetchWithRetry(legacyUrl, { headers: options.headers });
  if (!legacyResponse.ok) {
    await legacyResponse.body?.cancel().catch(() => undefined);
    throw new Error(`Failed to resolve agent card from ${canonicalUrl}`);
  }

  const card = (await legacyResponse.json()) as AgentCard;
  await options.verifyCard(card);
  return card;
}

export async function verifyResolvedA2AAgentCard(
  card: AgentCard,
  options: A2AAgentCardVerificationOptions,
): Promise<void> {
  const trustedVerificationKeys = options.trustedVerificationKeys ?? [];
  if (trustedVerificationKeys.length === 0 && !options.requireVerifiedAgentCard) {
    return;
  }

  const verification = await verifyAgentCard(card, trustedVerificationKeys);
  if (!verification.valid) {
    throw new Error('Agent card signature verification failed');
  }
}

function isExperimentalProtocolVersion(
  version: A2AProtocolVersion,
): version is A2AExperimentalProtocolVersion {
  const experimentalVersions: readonly A2AProtocolVersion[] = A2A_EXPERIMENTAL_PROTOCOL_VERSIONS;
  return experimentalVersions.includes(version);
}
