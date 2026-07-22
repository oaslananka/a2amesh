import { describe, expect, it } from 'vitest';
import * as auth from '../src/index.js';

describe('@a2amesh/internal-auth exports', () => {
  it('exposes the supported runtime authentication surface', () => {
    for (const exported of [
      auth.JwtAuthMiddleware,
      auth.attachRequestContext,
      auth.createAnonymousRequestContext,
      auth.createAuthenticatedRequestContext,
      auth.getRequestContext,
    ]) {
      expect(typeof exported).toBe('function');
    }
  });
});
