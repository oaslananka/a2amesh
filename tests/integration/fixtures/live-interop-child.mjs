#!/usr/bin/env node

const mode = process.argv[2] ?? 'ready';

if (mode === 'ready') {
  console.log(JSON.stringify({ type: 'ready', url: 'http://127.0.0.1:43123' }));
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => undefined, 1000);
} else if (mode === 'hang') {
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => undefined, 1000);
} else if (mode === 'fail') {
  console.error('participant failed before readiness');
  process.exit(7);
} else if (mode === 'secret-output') {
  const sensitiveValue = process.env['LIVE_INTEROP_TEST_SECRET'] ?? 'missing-value';
  console.error('x'.repeat(20 * 1024));
  console.error(`Authorization: Bearer ${sensitiveValue}`);
  console.error(`x-api-key: ${sensitiveValue}`);
  console.error(`Cookie: session=${sensitiveValue}`);
  process.exit(9);
} else {
  console.error(`unknown fixture mode: ${mode}`);
  process.exit(64);
}
