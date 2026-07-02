import { listFiles, readText, fail } from './check-utils.mjs';

const printSummary = process.argv.includes('--summary');
const packageByImport = new Map([
  ['@a2amesh/protocol', 'protocol'],
  ['@a2amesh/runtime', 'runtime'],
  ['@a2amesh/registry', 'registry'],
  ['@a2amesh/mcp', 'mcp'],
  ['@a2amesh/cli', 'cli'],
  ['@a2amesh/internal-adapters', 'adapters'],
  ['@a2amesh/internal-adapter-base', 'adapter-base'],
  ['@a2amesh/internal-adapter-openai', 'adapter-openai'],
  ['@a2amesh/internal-adapter-anthropic', 'adapter-anthropic'],
  ['@a2amesh/internal-adapter-langchain', 'adapter-langchain'],
  ['@a2amesh/internal-adapter-google-adk', 'adapter-google-adk'],
  ['@a2amesh/internal-adapter-llamaindex', 'adapter-llamaindex'],
  ['@a2amesh/internal-adapter-crewai', 'adapter-crewai'],
  ['@a2amesh/internal-auth', 'auth'],
  ['@a2amesh/internal-telemetry', 'telemetry'],
  ['@a2amesh/internal-transport-ws', 'transport-ws'],
  ['@a2amesh/internal-transport-grpc', 'transport-grpc'],
  ['@a2amesh/internal-fleet', 'fleet'],
  ['@a2amesh/internal-worker-runtime', 'worker-runtime'],
]);

const adapterImplementations = [
  'adapter-openai',
  'adapter-anthropic',
  'adapter-langchain',
  'adapter-google-adk',
  'adapter-llamaindex',
  'adapter-crewai',
];
const disallowed = {
  protocol: new Set([...packageByImport.values()].filter((name) => name !== 'protocol')),
  runtime: new Set([
    'registry',
    'mcp',
    'cli',
    'adapters',
    'adapter-base',
    ...adapterImplementations,
    'transport-ws',
    'transport-grpc',
    'fleet',
    'worker-runtime',
    'auth',
    'telemetry',
  ]),
  registry: new Set(['mcp', 'cli', 'adapters', 'adapter-base', ...adapterImplementations]),
  mcp: new Set(['registry', 'cli', 'adapters', 'adapter-base', ...adapterImplementations]),
  'adapter-base': new Set(['registry', 'cli', 'mcp', 'adapters', ...adapterImplementations]),
  'adapter-openai': new Set([
    'registry',
    'cli',
    'mcp',
    'adapters',
    ...adapterImplementations.filter((name) => name !== 'adapter-openai'),
  ]),
  'adapter-anthropic': new Set([
    'registry',
    'cli',
    'mcp',
    'adapters',
    ...adapterImplementations.filter((name) => name !== 'adapter-anthropic'),
  ]),
  'adapter-langchain': new Set([
    'registry',
    'cli',
    'mcp',
    'adapters',
    ...adapterImplementations.filter((name) => name !== 'adapter-langchain'),
  ]),
  'adapter-google-adk': new Set([
    'registry',
    'cli',
    'mcp',
    'adapters',
    ...adapterImplementations.filter((name) => name !== 'adapter-google-adk'),
  ]),
  'adapter-llamaindex': new Set([
    'registry',
    'cli',
    'mcp',
    'adapters',
    ...adapterImplementations.filter((name) => name !== 'adapter-llamaindex'),
  ]),
  'adapter-crewai': new Set([
    'registry',
    'cli',
    'mcp',
    'adapters',
    ...adapterImplementations.filter((name) => name !== 'adapter-crewai'),
  ]),
};

function ownerForFile(file) {
  const match = /^packages\/([^/]+)\//.exec(file);
  return match?.[1];
}

const failures = [];
for (const file of listFiles().filter((file) => /\.(ts|tsx|mts|mjs|js)$/.test(file))) {
  const owner = ownerForFile(file);
  if (!owner) continue;
  const text = readText(file);
  for (const [specifier, target] of packageByImport) {
    if (
      (text.includes(`'${specifier}'`) || text.includes(`"${specifier}"`)) &&
      disallowed[owner]?.has(target)
    ) {
      failures.push(`${file}: ${owner} must not import ${target}`);
    }
  }
}

if (failures.length > 0) fail('Workspace graph validation failed.', failures);

if (printSummary && failures.length === 0) {
  const disallowedEdgeCount = Object.values(disallowed).reduce(
    (total, targets) => total + targets.size,
    0,
  );
  console.log('Workspace graph validation passed.');
  console.log(
    `Checked ${packageByImport.size} package aliases across ${disallowedEdgeCount} forbidden dependency edges.`,
  );
  console.log(
    'Dependency direction: protocol -> runtime -> transports/client/registry -> adapters/bridges -> CLI/apps.',
  );
}
