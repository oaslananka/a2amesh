import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runPnpmSync } from './check-utils.mjs';

const examples = [
  'authenticated-server',
  'streaming',
  'push-notifications',
  'registry-tenancy',
  'websocket',
  'grpc',
  'mcp-bridge',
  'adapter-template',
  'agent-mesh',
  'local-cli-fleet',
];

const requiredFiles = [
  'README.md',
  'package.json',
  '.env.example',
  'src/index.ts',
  'tests/smoke.test.ts',
];
const failures = [];

for (const example of examples) {
  const directory = `examples/${example}`;
  for (const file of requiredFiles) {
    const path = `${directory}/${file}`;
    if (!existsSync(path)) {
      failures.push(`${path}: missing`);
    }
  }
}

if (failures.length > 0) {
  console.error('Example smoke validation failed.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

runPnpmSync(['run', 'build'], {
  stdio: 'inherit',
});

for (const example of examples) {
  const directory = `examples/${example}`;
  console.log(`\n> ${directory}`);
  execFileSync(process.execPath, ['--test', `${directory}/dist/tests/smoke.test.js`], {
    stdio: 'inherit',
  });
}
