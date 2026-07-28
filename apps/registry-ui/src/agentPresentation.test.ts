import { describe, expect, it } from 'vitest';
import { publicAgent, researcherAgent } from './test/fixtures';
import { describeAgentFreshness, describeAgentTrust } from './agentPresentation';

describe('agent presentation', () => {
  it('distinguishes current, stale, and never-observed health data', () => {
    const now = Date.parse('2026-04-06T10:05:00.000Z');

    expect(describeAgentFreshness(researcherAgent, 120_000, now)).toMatchObject({
      state: 'current',
    });
    expect(describeAgentFreshness(researcherAgent, 30_000, now)).toMatchObject({
      state: 'stale',
    });
    expect(describeAgentFreshness(publicAgent, 120_000, now)).toMatchObject({
      state: 'never',
    });
  });

  it('never treats missing or unsigned verification as trusted', () => {
    expect(describeAgentTrust(researcherAgent)).toMatchObject({
      state: 'trusted',
      label: 'Trusted Agent Card',
    });
    expect(describeAgentTrust(publicAgent)).toMatchObject({
      state: 'unverified',
      label: 'Unverified Agent Card',
    });
    expect(describeAgentTrust({ ...publicAgent, verification: undefined })).toMatchObject({
      state: 'missing',
      label: 'No trust evidence',
    });
  });
});
