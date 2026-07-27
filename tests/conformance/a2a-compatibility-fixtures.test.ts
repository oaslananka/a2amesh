import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { A2AClient } from '../../packages/runtime/src/client/A2AClient.js';
import { A2AServer } from '../../packages/runtime/src/server/A2AServer.js';
import {
  canonicalizeAgentCard,
  hashAgentCard,
  verifyAgentCard,
  type VerificationKey,
} from '../../packages/runtime/src/security/AgentCardSigner.js';
import { AgentCardSchema } from '../../packages/runtime/src/schemas/public.js';
import type { AgentCard } from '../../packages/runtime/src/types/agent-card.js';
import type { Artifact, Message, Task } from '../../packages/runtime/src/types/task.js';
import {
  parseConformanceProtocolVersion,
  type ConformanceProtocolVersion,
} from '../../packages/runtime/src/testing/conformance.js';
import { startTestServer, type StartedServer } from '../integration/helpers.js';

interface VersionNegotiationFixture {
  schemaVersion: '1.0';
  profiles: Array<{
    id: 'official-a2a-v1.0' | 'legacy-a2amesh' | 'experimental-a2a-v1.2';
    protocolVersion: '0.3' | '1.0' | '1.2';
    default: boolean;
    experimental: boolean;
  }>;
  cases: Array<{
    id: string;
    profile: 'official-a2a-v1.0' | 'legacy-a2amesh' | 'experimental-a2a-v1.2';
    header?: string;
    query?: string;
    expected:
      | { kind: 'success' }
      | { kind: 'error'; code: number; reason: string; requestedVersion: string };
  }>;
}

interface AuthenticatedExtendedCardFixture {
  schemaVersion: '1.0';
  profile: 'official-a2a-v1.0';
  security: { header: string; value: string };
  methods: Array<{
    id: string;
    method: 'agent/getAuthenticatedExtendedCard' | 'agent/authenticatedExtendedCard';
    classification: 'official' | 'legacy-alias';
  }>;
  expectedUnauthorizedCode: number;
  expectedCard: Pick<AgentCard, 'protocolVersion' | 'name' | 'version'>;
}

interface SignedAgentCardFixture {
  schemaVersion: '1.0';
  profile: 'official-a2a-v1.0';
  unsignedCard: AgentCard;
  signedCard: AgentCard;
  canonicalPayload: string;
  sha256: string;
  trustedKeys: {
    previous: VerificationKey;
    current: VerificationKey;
    unknown: VerificationKey;
  };
}

class CompatibilityFixtureAgent extends A2AServer {
  async handleTask(_task: Task, _message: Message): Promise<Artifact[]> {
    return [];
  }
}

function readCompatibilityFixture<T>(fileName: string): T {
  const fixtureUrl = new URL(`./fixtures/compatibility/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as T;
}

const versionFixture = readCompatibilityFixture<VersionNegotiationFixture>(
  'version-negotiation.json',
);
const authenticatedFixture = readCompatibilityFixture<AuthenticatedExtendedCardFixture>(
  'authenticated-extended-card.json',
);
const signedFixture = readCompatibilityFixture<SignedAgentCardFixture>('signed-agent-card.json');

const handles: StartedServer[] = [];

afterAll(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('fixture-backed A2A compatibility profiles', () => {
  it('separates official, legacy, and experimental profiles', () => {
    expect(versionFixture.schemaVersion).toBe('1.0');
    expect(versionFixture.profiles).toEqual([
      {
        id: 'official-a2a-v1.0',
        protocolVersion: '1.0',
        default: true,
        experimental: false,
      },
      {
        id: 'legacy-a2amesh',
        protocolVersion: '0.3',
        default: false,
        experimental: false,
      },
      {
        id: 'experimental-a2a-v1.2',
        protocolVersion: '1.2',
        default: false,
        experimental: true,
      },
    ]);

    const defaultProfiles = versionFixture.profiles.filter((profile) => profile.default);
    expect(defaultProfiles.map((profile) => profile.id)).toEqual(['official-a2a-v1.0']);

    for (const profile of versionFixture.profiles) {
      if (profile.protocolVersion === '0.3') continue;
      const version = profile.protocolVersion as ConformanceProtocolVersion;
      if (profile.experimental) {
        expect(() => parseConformanceProtocolVersion(version)).toThrow('experimental profile');
        expect(parseConformanceProtocolVersion(version, { allowExperimental: true })).toBe(version);
      } else {
        expect(parseConformanceProtocolVersion(version)).toBe(version);
      }
    }
  });

  it('replays supported, legacy, missing, unsupported, and conflicting HTTP versions', async () => {
    const agent = new CompatibilityFixtureAgent(structuredClone(signedFixture.unsignedCard));
    const handle = await startTestServer(agent);
    handles.push(handle);

    for (const fixtureCase of versionFixture.cases) {
      const endpoint = new URL('/a2a/jsonrpc', handle.url);
      if (fixtureCase.query) endpoint.search = fixtureCase.query;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(fixtureCase.header ? { 'A2A-Version': fixtureCase.header } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: fixtureCase.id,
          method: 'tasks/list',
          params: {},
        }),
      });
      const body = (await response.json()) as {
        result?: unknown;
        error?: {
          code: number;
          data?: Array<{ reason?: string; metadata?: Record<string, string> }>;
        };
      };

      expect(response.status, fixtureCase.id).toBe(200);
      if (fixtureCase.expected.kind === 'success') {
        expect(body.error, fixtureCase.id).toBeUndefined();
        expect(body.result, fixtureCase.id).toBeDefined();
      } else {
        expect(body.error?.code, fixtureCase.id).toBe(fixtureCase.expected.code);
        expect(body.error?.data?.[0], fixtureCase.id).toEqual(
          expect.objectContaining({
            reason: fixtureCase.expected.reason,
            metadata: expect.objectContaining({
              requestedVersion: fixtureCase.expected.requestedVersion,
            }),
          }),
        );
      }
    }
  });
});

describe('fixture-backed authenticated extended Agent Card compatibility', () => {
  it('requires authentication for canonical and legacy methods and returns the fixture card', async () => {
    const agent = new CompatibilityFixtureAgent(structuredClone(signedFixture.unsignedCard), {
      auth: {
        securitySchemes: [
          {
            type: 'apiKey',
            id: 'compatibility-key',
            in: 'header',
            name: authenticatedFixture.security.header,
          },
        ],
        apiKeys: { 'compatibility-key': authenticatedFixture.security.value },
      },
    });
    const handle = await startTestServer(agent);
    handles.push(handle);

    for (const methodFixture of authenticatedFixture.methods) {
      const withoutAuth = await postJsonRpc(handle.url, methodFixture.method);
      expect(withoutAuth.error?.code, methodFixture.id).toBe(
        authenticatedFixture.expectedUnauthorizedCode,
      );

      const withAuth = await postJsonRpc(handle.url, methodFixture.method, {
        [authenticatedFixture.security.header]: authenticatedFixture.security.value,
      });
      expect(withAuth.result, methodFixture.id).toEqual(
        expect.objectContaining(authenticatedFixture.expectedCard),
      );
    }
  });
});

describe('fixture-backed signed Agent Card trust', () => {
  it('keeps the canonical payload, schema, and digest stable', () => {
    expect(AgentCardSchema.parse(signedFixture.signedCard)).toEqual(signedFixture.signedCard);
    expect(canonicalizeAgentCard(signedFixture.signedCard)).toBe(signedFixture.canonicalPayload);
    expect(hashAgentCard(signedFixture.signedCard)).toBe(signedFixture.sha256);

    const reordered = Object.fromEntries(
      Object.entries(signedFixture.unsignedCard).reverse(),
    ) as AgentCard;
    expect(canonicalizeAgentCard(reordered)).toBe(signedFixture.canonicalPayload);
  });

  it('accepts previous and current rotation keys independently', async () => {
    await expect(
      verifyAgentCard(signedFixture.signedCard, [signedFixture.trustedKeys.previous]),
    ).resolves.toEqual({ valid: true, verifiedKeyId: signedFixture.trustedKeys.previous.keyId });
    await expect(
      verifyAgentCard(signedFixture.signedCard, [signedFixture.trustedKeys.current]),
    ).resolves.toEqual({ valid: true, verifiedKeyId: signedFixture.trustedKeys.current.keyId });
  });

  it('fails closed for unknown keys, malformed signatures, algorithm mismatch, and tampering', async () => {
    await expect(
      verifyAgentCard(signedFixture.signedCard, [signedFixture.trustedKeys.unknown]),
    ).resolves.toEqual({ valid: false });

    const currentSignature = signedFixture.signedCard.signatures?.find(
      (signature) => signature.keyId === signedFixture.trustedKeys.current.keyId,
    );
    expect(currentSignature).toBeDefined();

    const malformed: AgentCard = {
      ...signedFixture.signedCard,
      signatures: [{ ...currentSignature!, jws: 'not-a-compact-jws' }],
    };
    await expect(verifyAgentCard(malformed, [signedFixture.trustedKeys.current])).resolves.toEqual({
      valid: false,
    });

    const wrongAlgorithm: AgentCard = {
      ...signedFixture.signedCard,
      signatures: [{ ...currentSignature!, algorithm: 'RS256' }],
    };
    await expect(
      verifyAgentCard(wrongAlgorithm, [signedFixture.trustedKeys.current]),
    ).resolves.toEqual({ valid: false });

    const tampered: AgentCard = {
      ...signedFixture.signedCard,
      url: 'https://attacker.invalid/a2a',
    };
    await expect(verifyAgentCard(tampered, [signedFixture.trustedKeys.current])).resolves.toEqual({
      valid: false,
    });
  });

  it('makes A2AClient discovery accept trusted cards and reject tampered cards', async () => {
    const trustedServer = await serveCard(signedFixture.signedCard);
    const tamperedServer = await serveCard({
      ...signedFixture.signedCard,
      description: 'tampered after signing',
    });

    try {
      const trustedClient = new A2AClient(trustedServer.url, {
        trustedVerificationKeys: [signedFixture.trustedKeys.current],
        requireVerifiedAgentCard: true,
      });
      await expect(trustedClient.resolveCard()).resolves.toEqual(signedFixture.signedCard);

      const tamperedClient = new A2AClient(tamperedServer.url, {
        trustedVerificationKeys: [signedFixture.trustedKeys.current],
        requireVerifiedAgentCard: true,
      });
      await expect(tamperedClient.resolveCard()).rejects.toThrow(
        'Agent card signature verification failed',
      );
    } finally {
      await Promise.all([trustedServer.close(), tamperedServer.close()]);
    }
  });
});

async function postJsonRpc(
  baseUrl: string,
  method: string,
  headers: Record<string, string> = {},
): Promise<{ result?: AgentCard; error?: { code: number } }> {
  const response = await fetch(`${baseUrl}/a2a/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params: {} }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { result?: AgentCard; error?: { code: number } };
}

async function serveCard(card: AgentCard): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url === '/.well-known/agent-card.json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(card));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
