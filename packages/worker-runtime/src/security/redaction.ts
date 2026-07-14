const CREDENTIAL_NAME_PATTERN =
  /(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|credential|authorization|cookie|private[_-]?key)/i;

const STRUCTURED_SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]'],
  [
    /(\b(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|credential|authorization|cookie|private[_-]?key)\b\s*[:=]\s*["']?)[^\s"',;]+/gi,
    '$1[REDACTED]',
  ],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
];

export function collectSensitiveEnvironmentValues(
  environment: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(environment)
    .filter(([name, value]) => CREDENTIAL_NAME_PATTERN.test(name) && value.length >= 4)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

export function redactSensitiveText(
  input: string,
  explicitSensitiveValues: readonly string[] = [],
): string {
  let redacted = input;
  for (const value of explicitSensitiveValues) {
    if (value.length < 4) continue;
    redacted = redacted.split(value).join('[REDACTED]');
  }
  for (const [pattern, replacement] of STRUCTURED_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
