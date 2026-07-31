import { runOpenClawProbe } from './liveProbe.js';

try {
  const result = await runOpenClawProbe({ env: process.env });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'OpenClaw probe failed.');
  process.exitCode = 1;
}
