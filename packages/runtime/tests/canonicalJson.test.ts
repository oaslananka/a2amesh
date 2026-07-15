import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify } from '../src/testing/cassette/canonicalJson.js';

describe('canonicalJsonStringify', () => {
  it('sorts nested object keys with an explicit locale-aware comparator', () => {
    const first = {
      zeta: 1,
      nested: { omega: true, alpha: true },
      alpha: 2,
    };
    const second = {
      alpha: 2,
      nested: { alpha: true, omega: true },
      zeta: 1,
    };

    expect(canonicalJsonStringify(first)).toBe(canonicalJsonStringify(second));
    expect(canonicalJsonStringify(first)).toBe(
      '{"alpha":2,"nested":{"alpha":true,"omega":true},"zeta":1}',
    );
  });
});
