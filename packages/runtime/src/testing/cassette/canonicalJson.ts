/**
 * @file canonicalJson.ts
 * Deterministic JSON serialization (recursively key-sorted) used to compute
 * cassette integrity hashes independent of object property insertion order.
 */

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort((left, right) =>
      left.localeCompare(right, 'en-US'),
    );
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}
