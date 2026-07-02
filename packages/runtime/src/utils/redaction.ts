const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'api-key',
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'credential',
  'cookie',
  'session',
] as const;

export interface RedactionOptions {
  maxStringLength?: number | undefined;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function redactSensitiveText(value: string, options: RedactionOptions = {}): string {
  const maxStringLength = options.maxStringLength ?? 2_048;
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(
      /\b(api[_-]?key|token|client[_-]?secret|secret|password)=([^&\s,;"}]+)/gi,
      (_match, key: string) => `${key}=${REDACTED_VALUE}`,
    )
    .replace(/\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{12,}\b/g, REDACTED_VALUE);
  return redacted.length > maxStringLength ? `${redacted.slice(0, maxStringLength)}…` : redacted;
}

function redactValue(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && isSensitiveKey(key)) return REDACTED_VALUE;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, undefined, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, seen),
    ]),
  );
}

export function redactRecord<T extends Record<string, unknown>>(record: T): T {
  return redactValue(record) as T;
}

export function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const redacted: Record<string, string> = {};
  const entries: Array<[string, string]> =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Array.isArray(headers)
        ? headers.map(([key, value]) => [key, String(value)])
        : Object.entries(headers).map(([key, value]) => [key, String(value)]);
  for (const [key, value] of entries) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactSensitiveText(value);
  }
  return redacted;
}
