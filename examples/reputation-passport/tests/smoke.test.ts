import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computePassportSignature,
  evaluateReputationPassport,
  type PassportValidationReason,
  type ReputationPassport,
} from '../src/passport-verifier.js';

const SECRET = 'synthetic-test-signing-secret-key-12345';
const ISSUER = 'https://trust.passport.example';
const SUBJECT = 'agent-uuid-1234';
const ENDPOINT = 'http://127.0.0.1:3001';
const NOW = new Date('2026-09-15T12:00:00.000Z');

function validPassport(overrides: Partial<ReputationPassport> = {}): ReputationPassport {
  const base = {
    version: '1.0' as const,
    issuer: ISSUER,
    subject: SUBJECT,
    endpoint: ENDPOINT,
    score: 85,
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
  return { ...base, signature: computePassportSignature(base, SECRET) };
}

void describe('Reputation Passport Evaluation Example', () => {
  const testCases: Array<{
    name: string;
    passport: unknown;
    issuer?: string;
    subject?: string;
    endpoint?: string;
    expectedValid: boolean;
    expectedReason: PassportValidationReason;
  }> = [
    {
      name: 'valid passport credential',
      passport: validPassport(),
      expectedValid: true,
      expectedReason: 'valid',
    },
    {
      name: 'wrong issuer',
      passport: validPassport(),
      issuer: 'https://untrusted.example',
      expectedValid: false,
      expectedReason: 'invalid_issuer',
    },
    {
      name: 'wrong subject',
      passport: validPassport(),
      subject: 'other-agent-id',
      expectedValid: false,
      expectedReason: 'mismatched_subject',
    },
    {
      name: 'expired credential',
      passport: validPassport({
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2026-09-01T00:00:00.000Z',
      }),
      expectedValid: false,
      expectedReason: 'expired_passport',
    },
    {
      name: 'future-dated credential',
      passport: validPassport({
        validFrom: '2026-10-01T00:00:00.000Z',
        validUntil: '2026-11-01T00:00:00.000Z',
      }),
      expectedValid: false,
      expectedReason: 'future_dated_passport',
    },
    {
      name: 'invalid signature',
      passport: { ...validPassport(), signature: 'deadbeef12345678' },
      expectedValid: false,
      expectedReason: 'invalid_signature',
    },
    {
      name: 'mismatched endpoint binding',
      passport: validPassport({ endpoint: 'http://127.0.0.1:9999' }),
      expectedValid: false,
      expectedReason: 'mismatched_endpoint',
    },
    {
      name: 'malformed input',
      passport: 'not-a-json-object',
      expectedValid: false,
      expectedReason: 'malformed_passport',
    },
  ];

  for (const tc of testCases) {
    void it(`evaluates ${tc.name}`, () => {
      const res = evaluateReputationPassport({
        passport: tc.passport,
        expectedIssuer: tc.issuer ?? ISSUER,
        expectedSubject: tc.subject ?? SUBJECT,
        expectedEndpoint: tc.endpoint ?? ENDPOINT,
        signingSecret: SECRET,
        now: NOW,
      });
      assert.equal(res.isValid, tc.expectedValid);
      assert.equal(res.reasonCode, tc.expectedReason);
    });
  }
});
