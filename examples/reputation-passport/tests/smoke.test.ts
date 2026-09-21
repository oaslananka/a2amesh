import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computePassportSignature,
  evaluateReputationPassport,
  type ReputationPassport,
} from '../src/passport-verifier.js';

const SECRET = 'synthetic-test-signing-secret-key-12345';
const ISSUER = 'https://trust.passport.example';
const SUBJECT = 'agent-uuid-1234';
const ENDPOINT = 'http://127.0.0.1:3001';

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
  const signature = computePassportSignature(base, SECRET);
  return { ...base, signature };
}

void describe('Reputation Passport Evaluation Example', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');

  void it('validates a correct passport credential', () => {
    const passport = validPassport();
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, true);
    assert.equal(result.reasonCode, 'valid');
    assert.equal(result.score, 85);
  });

  void it('rejects wrong issuer', () => {
    const passport = validPassport();
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: 'https://untrusted.example',
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'invalid_issuer');
  });

  void it('rejects wrong subject', () => {
    const passport = validPassport();
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: ISSUER,
      expectedSubject: 'other-agent-id',
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'mismatched_subject');
  });

  void it('rejects expired credential', () => {
    const passport = validPassport({
      validFrom: '2026-08-01T00:00:00.000Z',
      validUntil: '2026-09-01T00:00:00.000Z',
    });
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'expired_passport');
  });

  void it('rejects future-dated credential', () => {
    const passport = validPassport({
      validFrom: '2026-10-01T00:00:00.000Z',
      validUntil: '2026-11-01T00:00:00.000Z',
    });
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'future_dated_passport');
  });

  void it('rejects invalid signature', () => {
    const passport = { ...validPassport(), signature: 'deadbeef12345678' };
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'invalid_signature');
  });

  void it('rejects missing or mismatched endpoint binding', () => {
    const passport = validPassport({ endpoint: 'http://127.0.0.1:9999' });
    const result = evaluateReputationPassport({
      passport,
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'mismatched_endpoint');
  });

  void it('rejects malformed input', () => {
    const result = evaluateReputationPassport({
      passport: 'not-a-json-object',
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedEndpoint: ENDPOINT,
      signingSecret: SECRET,
      now,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.reasonCode, 'malformed_passport');
  });
});
