import { describe, expect, it, vi } from 'vitest';
import {
  createA2AProtocolHeaders,
  getA2AProtocolPreferences,
  resolveA2AAgentCard,
  selectA2AAgentInterface,
} from '../src/client/A2AClientAgentCard.js';
import type { AgentCard } from '../src/types/agent-card.js';

function createCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    protocolVersion: '1.0',
    name: 'Card Agent',
    description: 'Agent card resolution test',
    url: 'https://legacy.example/a2a',
    version: '1.0.0',
    ...overrides,
  };
}

describe('A2A client Agent Card resolution', () => {
  it('orders official and explicitly enabled experimental protocol preferences', () => {
    expect(getA2AProtocolPreferences({})).toEqual(['1.0']);
    expect(
      getA2AProtocolPreferences({
        allowExperimentalProtocolVersions: true,
        preferredProtocolVersion: '1.2',
      }),
    ).toEqual(['1.2', '1.0']);
    expect(() => getA2AProtocolPreferences({ preferredProtocolVersion: '1.2' })).toThrow(
      'Set allowExperimentalProtocolVersions to true',
    );
  });

  it('selects interfaces by negotiated preference without treating legacy URLs as structured interfaces', () => {
    const card = createCard({
      supportedInterfaces: [
        {
          url: 'https://experimental.example/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.2',
        },
        {
          url: 'https://official.example/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
      ],
    });

    expect(selectA2AAgentInterface(card, {})).toMatchObject({
      url: 'https://official.example/a2a',
      protocolVersion: '1.0',
    });
    expect(
      selectA2AAgentInterface(card, {
        allowExperimentalProtocolVersions: true,
        preferredProtocolVersion: '1.2',
      }),
    ).toMatchObject({
      url: 'https://experimental.example/a2a',
      protocolVersion: '1.2',
    });
    expect(selectA2AAgentInterface(createCard(), {})).toBeUndefined();
  });

  it('resolves canonical cards and falls back to the legacy well-known path', async () => {
    const canonical = createCard({ name: 'Canonical' });
    const canonicalFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(canonical), { status: 200 }));

    await expect(
      resolveA2AAgentCard({
        baseUrl: 'https://agent.example',
        cardPath: '/custom-card.json',
        headers: createA2AProtocolHeaders({ 'x-client': 'test' }, '1.0'),
        fetchWithRetry: canonicalFetch,
        verifyCard: vi.fn(),
      }),
    ).resolves.toEqual(canonical);
    expect(String(canonicalFetch.mock.calls[0]?.[0])).toBe(
      'https://agent.example/custom-card.json',
    );

    const legacy = createCard({ name: 'Legacy' });
    const fallbackFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(legacy), { status: 200 }));
    const verifyCard = vi.fn();

    await expect(
      resolveA2AAgentCard({
        baseUrl: 'https://agent.example',
        cardPath: '/.well-known/agent-card.json',
        headers: { 'A2A-Version': '1.0' },
        fetchWithRetry: fallbackFetch,
        verifyCard,
      }),
    ).resolves.toEqual(legacy);
    expect(fallbackFetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://agent.example/.well-known/agent-card.json',
      'https://agent.example/.well-known/agent.json',
    ]);
    expect(verifyCard).toHaveBeenCalledWith(legacy);
  });

  it('fails with the canonical URL when both well-known endpoints reject the card', async () => {
    const fetchWithRetry = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(
      resolveA2AAgentCard({
        baseUrl: 'https://agent.example',
        cardPath: '/.well-known/agent-card.json',
        headers: { 'A2A-Version': '1.0' },
        fetchWithRetry,
        verifyCard: vi.fn(),
      }),
    ).rejects.toThrow(
      'Failed to resolve agent card from https://agent.example/.well-known/agent-card.json',
    );
  });
});
