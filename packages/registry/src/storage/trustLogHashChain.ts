import { createHash } from 'node:crypto';
import type { TrustLogEntryInput } from './ITrustLogStorage.js';

function compareOrdinal(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareOrdinal)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Shared by every `ITrustLogStorage` implementation so the hash chain is
 * identical regardless of backend -- switching a registry from
 * `InMemoryTrustLogStorage` to `SqliteTrustLogStorage` must not change the
 * `entryHash` a given sequence of appends produces.
 */
export const TRUST_LOG_GENESIS_HASH = createHash('sha256')
  .update('a2amesh-trust-log-genesis')
  .digest('hex');

export function computeTrustLogEntryHash(
  previousHash: string,
  entry: TrustLogEntryInput & { sequence: number },
): string {
  return createHash('sha256')
    .update(previousHash)
    .update(canonicalJsonStringify(entry))
    .digest('hex');
}
