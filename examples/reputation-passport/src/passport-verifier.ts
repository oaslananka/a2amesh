import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ReputationPassport {
  version: '1.0';
  issuer: string;
  subject: string;
  endpoint: string;
  score: number;
  validFrom: string;
  validUntil: string;
  signature: string;
}

export type PassportValidationReason =
  | 'valid'
  | 'malformed_passport'
  | 'invalid_issuer'
  | 'mismatched_subject'
  | 'mismatched_endpoint'
  | 'expired_passport'
  | 'future_dated_passport'
  | 'invalid_signature'
  | 'score_below_threshold';

export interface PassportEvaluationOptions {
  passport: unknown;
  expectedIssuer: string;
  expectedSubject: string;
  expectedEndpoint: string;
  minScore?: number;
  signingSecret: string;
  now?: Date;
}

export interface PassportEvaluationResult {
  isValid: boolean;
  reasonCode: PassportValidationReason;
  score?: number;
}

export function computePassportSignature(
  passport: Omit<ReputationPassport, 'signature'>,
  secret: string,
): string {
  const payload = `${passport.version}:${passport.issuer}:${passport.subject}:${passport.endpoint}:${passport.score}:${passport.validFrom}:${passport.validUntil}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function evaluateReputationPassport(
  options: PassportEvaluationOptions,
): PassportEvaluationResult {
  const {
    passport,
    expectedIssuer,
    expectedSubject,
    expectedEndpoint,
    minScore = 0,
    signingSecret,
    now = new Date(),
  } = options;

  if (!passport || typeof passport !== 'object' || Array.isArray(passport)) {
    return { isValid: false, reasonCode: 'malformed_passport' };
  }

  const p = passport as Partial<ReputationPassport>;

  if (
    p.version !== '1.0' ||
    typeof p.issuer !== 'string' ||
    typeof p.subject !== 'string' ||
    typeof p.endpoint !== 'string' ||
    typeof p.score !== 'number' ||
    typeof p.validFrom !== 'string' ||
    typeof p.validUntil !== 'string' ||
    typeof p.signature !== 'string'
  ) {
    return { isValid: false, reasonCode: 'malformed_passport' };
  }

  if (p.issuer !== expectedIssuer) {
    return { isValid: false, reasonCode: 'invalid_issuer' };
  }

  if (p.subject !== expectedSubject) {
    return { isValid: false, reasonCode: 'mismatched_subject' };
  }

  if (p.endpoint !== expectedEndpoint) {
    return { isValid: false, reasonCode: 'mismatched_endpoint' };
  }

  const validFrom = new Date(p.validFrom);
  const validUntil = new Date(p.validUntil);

  if (Number.isNaN(validFrom.valueOf()) || Number.isNaN(validUntil.valueOf())) {
    return { isValid: false, reasonCode: 'malformed_passport' };
  }

  if (now.valueOf() < validFrom.valueOf()) {
    return { isValid: false, reasonCode: 'future_dated_passport' };
  }

  if (now.valueOf() > validUntil.valueOf()) {
    return { isValid: false, reasonCode: 'expired_passport' };
  }

  const expectedSignature = computePassportSignature(
    {
      version: p.version,
      issuer: p.issuer,
      subject: p.subject,
      endpoint: p.endpoint,
      score: p.score,
      validFrom: p.validFrom,
      validUntil: p.validUntil,
    },
    signingSecret,
  );

  const sigBuffer = Buffer.from(p.signature, 'hex');
  const expBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    sigBuffer.length !== expBuffer.length ||
    !timingSafeEqual(sigBuffer, expBuffer)
  ) {
    return { isValid: false, reasonCode: 'invalid_signature' };
  }

  if (p.score < minScore) {
    return { isValid: false, reasonCode: 'score_below_threshold', score: p.score };
  }

  return { isValid: true, reasonCode: 'valid', score: p.score };
}
