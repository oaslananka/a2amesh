import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|x-api-key|cookie|set-cookie)$/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactText(input, secrets = []) {
  let value = String(input);
  value = value
    .replace(/\b(Authorization|Proxy-Authorization)\s*:\s*[^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(x-api-key)\s*:\s*[^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, '$1: [REDACTED]');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      value = value.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
    }
  }
  return value;
}

export function redactDiagnostic(value, secrets = [], key = '') {
  if (SENSITIVE_HEADER.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactText(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnostic(item, secrets));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDiagnostic(entryValue, secrets, entryKey),
      ]),
    );
  }
  return value;
}

export async function writeLiveInteropReport(root, report, outputPath) {
  const reportPath = outputPath ?? path.join(root, 'artifacts/interop-live/report.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}
