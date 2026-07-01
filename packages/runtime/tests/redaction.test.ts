import { describe, expect, it } from 'vitest';
import { redactHeaders, redactRecord, redactSensitiveText } from '../src/utils/redaction.js';

describe('observability redaction helpers', () => {
  it('redacts sensitive nested fields and URL-style parameters', () => {
    const redacted = redactRecord({
      Authorization: 'Bearer production-token',
      nested: {
        api_key: 'abc123',
        callback: 'https://example.com/hook?token=secret-token&value=ok',
      },
      publicValue: 'visible',
    });

    expect(JSON.stringify(redacted)).not.toContain('production-token');
    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(redacted).toMatchObject({
      Authorization: '[REDACTED]',
      nested: {
        api_key: '[REDACTED]',
        callback: 'https://example.com/hook?token=[REDACTED]&value=ok',
      },
      publicValue: 'visible',
    });
  });

  it('redacts credential-like free text and headers from diagnostics', () => {
    expect(redactSensitiveText('Authorization: Bearer token-value')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
    expect(
      redactHeaders({
        Authorization: 'Bearer token-value',
        Cookie: 'sid=session-value',
        'Content-Type': 'application/json',
      }),
    ).toEqual({
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'Content-Type': 'application/json',
    });
  });

  it('handles every header container form', () => {
    expect(redactHeaders(undefined)).toEqual({});
    expect(redactHeaders([['X-Api-Key', 'array-key']])).toEqual({ 'X-Api-Key': '[REDACTED]' });
    expect(redactHeaders(new Headers({ Cookie: 'sid=value', Accept: 'application/json' }))).toEqual({
      accept: 'application/json',
      cookie: '[REDACTED]',
    });
  });

});
