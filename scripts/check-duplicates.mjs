import { runPnpmSync } from './check-utils.mjs';

const paths = [
  'packages/runtime/src',
  'packages/adapters/src',
  'packages/registry/src',
  'packages/transport-ws/src',
  'packages/transport-grpc/src',
  'packages/mcp/src',
  'packages/create-a2amesh/src',
  'packages/cli/src',
  'apps/demo',
  'apps/registry-ui/src',
];

const jscpdArgs = [
  'jscpd',
  '--ignore',
  '**/node_modules/**,**/dist/**,**/coverage/**,**/test-results/**,**/tests/**,**/*.test.ts,**/*.test.tsx,**/*.spec.ts',
  '--threshold',
  '2',
  '--reporters',
  'console',
  '--no-tips',
  ...paths,
];

runPnpmSync(['exec', ...jscpdArgs], { stdio: 'inherit' });
