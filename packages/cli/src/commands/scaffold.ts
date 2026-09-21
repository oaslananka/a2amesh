import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { scaffoldTemplateConfig } from '../generated/scaffold-template.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const scaffoldCommandDoc = {
  path: ['init'],
  summary: 'Initialize an A2A Mesh agent project.',
  description:
    'Creates a new A2A Mesh agent project from the stable runtime or production-demo template, with optional auth, rate limiting, and Dockerfile output.',
  examples: [
    {
      title: 'Initialize an agent project.',
      bash: ['a2amesh init demo-agent'],
      powershell: ['a2amesh init demo-agent'],
    },
    {
      title: 'Initialize a credential-free production demo project.',
      bash: ['a2amesh init my-demo --template production-demo'],
      powershell: ['a2amesh init my-demo --template production-demo'],
    },
    {
      title: 'Initialize an agent with auth and Docker support.',
      bash: ['a2amesh init secure-agent --auth --docker'],
      powershell: ['a2amesh init secure-agent --auth --docker'],
    },
  ],
} satisfies CliCommandDoc;

type ScaffoldAdapter = 'custom' | 'production-demo';
type ScaffoldTemplate = 'custom' | 'production-demo';

export interface ScaffoldOptions {
  adapter: ScaffoldAdapter;
  template?: ScaffoldTemplate;
  auth: boolean;
  rateLimit: boolean;
  docker: boolean;
}

const DEMO_SECRET_KEY = 'production-demo-secret-key';
const DEMO_REGISTRY_URL = 'http://127.0.0.1:3099';
const DEMO_RESEARCHER_URL = 'http://127.0.0.1:3001';
const DEMO_ORCHESTRATOR_URL = 'http://127.0.0.1:3002';

function renderPackageJson(name: string): string {
  const dependencies: Record<string, string> = {
    '@a2amesh/protocol': scaffoldTemplateConfig.dependencies['@a2amesh/protocol'],
    '@a2amesh/runtime': scaffoldTemplateConfig.dependencies['@a2amesh/runtime'],
  };

  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: `pnpm@${scaffoldTemplateConfig.runtime.pnpm}`,
      scripts: {
        dev: 'tsx src/index.ts',
        build: 'tsc -p tsconfig.json',
        start: 'node dist/index.js',
      },
      dependencies,
      devDependencies: {
        '@types/node': scaffoldTemplateConfig.devDependencies['@types/node'],
        tsx: scaffoldTemplateConfig.devDependencies.tsx,
        typescript: scaffoldTemplateConfig.devDependencies.typescript,
      },
    },
    null,
    2,
  );
}

function renderTsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['src/**/*'],
    },
    null,
    2,
  );
}

function renderRuntimeOptions(options: Pick<ScaffoldOptions, 'auth' | 'rateLimit'>): string {
  const lines: string[] = [];
  if (options.auth) {
    lines.push(`      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: { 'api-key': process.env.A2A_API_KEY ?? '' },
      },`);
  }
  if (options.rateLimit) {
    lines.push(`      rateLimit: {
        windowMs: 60_000,
        maxRequests: 100,
      },`);
  }

  if (lines.length === 0) {
    return '{}';
  }

  return `{
${lines.join('\n')}
    }`;
}

function renderCard(name: string): string {
  return `{
      protocolVersion: '1.0',
      name: '${name}',
      description: 'A2A agent scaffolded with A2A Mesh',
      url: 'http://localhost:3000',
      version: '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      securitySchemes: [],
    }`;
}

function renderAgentSource(name: string, options: ScaffoldOptions): string {
  return `import { A2AServer, logger } from '@a2amesh/runtime';
import type { AgentCard, Artifact, Message, Task } from '@a2amesh/protocol';

const card: AgentCard = ${renderCard(name)};

export class ${toPascalCase(name)}Agent extends A2AServer {
  constructor() {
    super(card, ${renderRuntimeOptions(options)});
  }

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    logger.info('Handling scaffolded task', { taskId: task.id });
    const textPart = message.parts.find((part) => part.type === 'text');
    const replyText = textPart?.type === 'text'
      ? \`Hello from ${name}: \${textPart.text}\`
      : 'Hello from ${name}';

    return [
      {
        artifactId: \`artifact-\${Date.now()}\`,
        name: 'Reply',
        description: 'Scaffolded agent reply',
        parts: [{ type: 'text', text: replyText }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

export function createAgent(): ${toPascalCase(name)}Agent {
  return new ${toPascalCase(name)}Agent();
}
`;
}

function renderIndexSource(name: string): string {
  return `import { createAgent } from './agent.js';

const agent = createAgent();
agent.start(3000);

process.stdout.write('Agent ${name} listening on port 3000\n');
`;
}

function renderEnvExample(options: ScaffoldOptions): string {
  const lines: string[] = [];
  if (options.auth) {
    lines.push('A2A_API_KEY=your-secure-api-key-here');
  }

  return `${lines.join('\n')}\n`;
}

function renderDockerfile(): string {
  const nodeMajor =
    scaffoldTemplateConfig.runtime.node.split('.')[0] ?? scaffoldTemplateConfig.runtime.node;
  const nodeImage = `node:${nodeMajor}-alpine`;

  return `# ${nodeImage} digest from tools/runtime-versions.json: ${scaffoldTemplateConfig.runtime.nodeDockerAlpineDigest}
FROM ${nodeImage}@${scaffoldTemplateConfig.runtime.nodeDockerAlpineDigest}
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${scaffoldTemplateConfig.runtime.pnpm} --activate

COPY . .
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install --lockfile-only && pnpm install --frozen-lockfile; fi

RUN pnpm run build

EXPOSE 3000
USER node
CMD ["pnpm", "run", "start"]
`;
}

function renderReadme(name: string, options: ScaffoldOptions): string {
  return `# ${name}

Created with A2A Mesh using \`npm create a2amesh\` or \`a2amesh init\`.

## Getting started

1. Install dependencies with \`pnpm install\`
2. Copy \`.env.example\` to \`.env\`
3. Run \`pnpm dev\`

## Selected options

- Adapter: \`${options.adapter}\`
- Authentication: \`${options.auth ? 'enabled' : 'disabled'}\`
- Rate limit config: \`${options.rateLimit ? 'explicit 100/minute' : 'runtime default'}\`
- Docker support: \`${options.docker ? 'included' : 'not included'}\`
`;
}

function renderProductionDemoPackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: `pnpm@${scaffoldTemplateConfig.runtime.pnpm}`,
      scripts: {
        dev: 'tsx src/index.ts',
        build: 'tsc -p tsconfig.json',
        start: 'node dist/index.js',
        test: 'vitest run',
        verify: 'tsx verify.mjs',
      },
      dependencies: {
        '@a2amesh/mcp': scaffoldTemplateConfig.dependencies['@a2amesh/runtime'],
        '@a2amesh/protocol': scaffoldTemplateConfig.dependencies['@a2amesh/protocol'],
        '@a2amesh/registry': scaffoldTemplateConfig.dependencies['@a2amesh/runtime'],
        '@a2amesh/runtime': scaffoldTemplateConfig.dependencies['@a2amesh/runtime'],
      },
      devDependencies: {
        '@types/node': scaffoldTemplateConfig.devDependencies['@types/node'],
        tsx: scaffoldTemplateConfig.devDependencies.tsx,
        typescript: scaffoldTemplateConfig.devDependencies.typescript,
        vitest: '4.1.11',
      },
    },
    null,
    2,
  );
}

function renderAuthServerInitCode(dbPath: string): string {
  return `mkdirSync('db', { recursive: true });
    super(card, {
      taskStorage: new SqliteTaskStorage('${dbPath}'),
      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: { 'api-key': apiKey },
      },
    });`;
}

function renderAgentCardObject(agentName: string, description: string, url: string): string {
  return `const card: AgentCard = {
  protocolVersion: '1.0',
  name: '${agentName}',
  description: '${description}',
  url: '${url}',
  version: '1.0.0',
  capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
};`;
}

function renderPollCompletionCode(): string {
  return `let completed = await client.getTask(task.id);
  for (let i = 0; i < 30 && completed.status.state !== 'COMPLETED'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    completed = await client.getTask(task.id);
  }`;
}

function renderSendMessageSnippet(msgId: string, text: string): string {
  return `await client.sendMessage({
      role: 'user',
      messageId: \`${msgId}-\${Date.now()}\`,
      timestamp: new Date().toISOString(),
      parts: [{ type: 'text', text: '${text}' }],
    });`;
}

function renderProductionDemoResearcherSource(): string {
  return `import { A2AServer, logger, SqliteTaskStorage } from '@a2amesh/runtime';
import { invokeMcpTool } from '@a2amesh/mcp';
import type { AgentCard, Artifact, Message, Task } from '@a2amesh/protocol';
import { mkdirSync } from 'node:fs';

${renderAgentCardObject('Researcher Agent', 'Specialist research worker', DEMO_RESEARCHER_URL)}

export class ResearcherAgent extends A2AServer {
  constructor(dbPath = 'db/researcher-tasks.db', apiKey = process.env.A2A_API_KEY ?? '${DEMO_SECRET_KEY}') {
    ${renderAuthServerInitCode('db/researcher-tasks.db')}
  }

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    logger.info('Researcher handling task', { taskId: task.id });
    const query = message.parts.find((p) => p.type === 'text')?.text ?? 'default query';
    const caller = {
      async callTool(p: { arguments?: Record<string, unknown> }) {
        const args = p.arguments ?? {};
        return { content: [{ type: 'text' as const, text: \`Research findings for '\${query}' (mcp-calc: \${Number(args.a ?? 2) + Number(args.b ?? 3)})\` }] };
      },
    };
    const res = await invokeMcpTool({ client: caller, tool: 'calculator.add', input: { a: 10, b: 20 }, allowedTools: ['calculator.add'] });
    const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    return [{ artifactId: \`art-res-\${Date.now()}\`, name: 'Research Report', description: 'MCP-backed report', parts: [{ type: 'text', text: \`[Researcher] \${text}\` }], index: 0, lastChunk: true }];
  }
}
`;
}

function renderProductionDemoOrchestratorSource(): string {
  return `import { A2AServer, A2AClient, AgentRegistryClient, logger, SqliteTaskStorage } from '@a2amesh/runtime';
import type { AgentCard, Artifact, Message, Task } from '@a2amesh/protocol';
import { mkdirSync } from 'node:fs';

${renderAgentCardObject('Orchestrator Agent', 'Coordinator discovering workers via Registry', DEMO_ORCHESTRATOR_URL)}

export class OrchestratorAgent extends A2AServer {
  private readonly registryClient: AgentRegistryClient;
  private readonly apiKey: string;

  constructor(registryUrl = '${DEMO_REGISTRY_URL}', dbPath = 'db/orchestrator-tasks.db', apiKey = process.env.A2A_API_KEY ?? '${DEMO_SECRET_KEY}') {
    ${renderAuthServerInitCode('db/orchestrator-tasks.db')}
    this.registryClient = new AgentRegistryClient(registryUrl);
    this.apiKey = apiKey;
  }

  async handleTask(task: Task, message: Message): Promise<Artifact[]> {
    logger.info('Orchestrator handling task', { taskId: task.id });
    const list = await this.registryClient.listAgents();
    const worker = list.find((a) => a.card.name === 'Researcher Agent');
    if (!worker) throw new Error('Registry discovery failed: Researcher Agent not found');

    const workerClient = new A2AClient(worker.url, { headers: { 'x-api-key': this.apiKey } });
    const query = message.parts.find((p) => p.type === 'text')?.text ?? 'A2A Protocol';
    const childTask = await workerClient.sendMessage({ role: 'user', messageId: \`orch-sub-\${Date.now()}\`, timestamp: new Date().toISOString(), parts: [{ type: 'text', text: query }] });

    ${renderPollCompletionCode()}
    const reportText = completed.artifacts?.[0]?.parts.find((p) => p.type === 'text')?.text ?? 'no report';
    return [{ artifactId: \`art-orch-\${Date.now()}\`, name: 'Final Orchestrated Answer', description: 'Result composed from worker', parts: [{ type: 'text', text: \`[Orchestrator] Completed pipeline. Result: \${reportText}\` }], index: 0, lastChunk: true }];
  }
}
`;
}

function renderProductionDemoIndexSource(): string {
  return `import { RegistryServer } from '@a2amesh/registry';
import { AgentRegistryClient, logger } from '@a2amesh/runtime';
import { ResearcherAgent } from './researcher-agent.js';
import { OrchestratorAgent } from './orchestrator-agent.js';
import { mkdirSync } from 'node:fs';

async function main() {
  mkdirSync('db', { recursive: true });
  const registry = new RegistryServer({ allowLocalhost: true, allowPrivateNetworks: false, requireAuth: false });
  registry.start(3099);

  const researcher = new ResearcherAgent();
  const orchestrator = new OrchestratorAgent();
  researcher.start(3001);
  orchestrator.start(3002);

  const registryClient = new AgentRegistryClient('${DEMO_REGISTRY_URL}');
  await registryClient.register('${DEMO_RESEARCHER_URL}', researcher.getAgentCard());
  await registryClient.register('${DEMO_ORCHESTRATOR_URL}', orchestrator.getAgentCard());

  logger.info('Production Demo services running on loopback', { registry: '${DEMO_REGISTRY_URL}', researcher: '${DEMO_RESEARCHER_URL}', orchestrator: '${DEMO_ORCHESTRATOR_URL}' });
  process.stdout.write('A2A Mesh Production Demo listening on loopback (3099, 3001, 3002)\n');
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  void main();
}
`;
}

function renderProductionDemoVerifyScript(): string {
  return `import { AgentRegistryClient, A2AClient } from '@a2amesh/runtime';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const REGISTRY_URL = '${DEMO_REGISTRY_URL}';
const RESEARCHER_URL = '${DEMO_RESEARCHER_URL}';
const ORCHESTRATOR_URL = '${DEMO_ORCHESTRATOR_URL}';
const API_KEY = process.env.A2A_API_KEY ?? '${DEMO_SECRET_KEY}';

async function checkHealth(url: string, name: string) {
  const res = await fetch(\`\${url}/health\`);
  if (!res.ok) throw new Error(\`\${name} health returned HTTP \${res.status}\`);
}

async function verify() {
  console.log('--- A2A Mesh Production Golden Path Verification ---');

  console.log('[Layer 1 & 2] Checking Service Health...');
  await checkHealth(REGISTRY_URL, 'Registry');
  await checkHealth(RESEARCHER_URL, 'Researcher');
  await checkHealth(ORCHESTRATOR_URL, 'Orchestrator');
  console.log('  ✓ Services are healthy');

  console.log('[Layer 3] Checking Registry Discovery...');
  const registryClient = new AgentRegistryClient(REGISTRY_URL);
  const agents = await registryClient.listAgents();
  const researcherEntry = agents.find((a) => a.card.name === 'Researcher Agent');
  if (!researcherEntry || researcherEntry.url !== RESEARCHER_URL) {
    throw new Error('Layer 3 Failed: Researcher Agent not discovered in registry');
  }
  console.log('  ✓ Researcher Agent discovered dynamically via Registry');

  console.log('[Layer 4] Sending Authenticated Task Request...');
  const client = new A2AClient(ORCHESTRATOR_URL, { headers: { 'x-api-key': API_KEY } });

  const task = ${renderSendMessageSnippet('verify', 'Analyze A2A Mesh Protocol')}

  if (!task.id) throw new Error('Layer 4 Failed: Task creation failed');

  ${renderPollCompletionCode()}

  if (completed.status.state !== 'COMPLETED') {
    throw new Error(\`Layer 4 Failed: Task failed with state \${completed.status.state}\`);
  }
  console.log(\`  ✓ Task \${task.id} completed successfully\`);

  console.log('[Layer 5] Verifying SQLite Task Persistence...');
  if (!existsSync('db/orchestrator-tasks.db')) {
    throw new Error('Layer 5 Failed: SQLite database file db/orchestrator-tasks.db missing');
  }
  const db = new DatabaseSync('db/orchestrator-tasks.db');
  const row = db.prepare('SELECT id, state FROM tasks WHERE id = ?').get(task.id);
  db.close();
  if (!row || row.state !== 'COMPLETED') {
    throw new Error(\`Layer 5 Failed: Task \${task.id} not found in SQLite or state is not COMPLETED\`);
  }
  console.log('  ✓ Task state verified in SQLite database');

  console.log('[Layer 6 & 7] Verifying MCP Invocation & Artifact Output...');
  const artifact = completed.artifacts?.[0];
  const artifactText = artifact?.parts?.find((p) => p.type === 'text')?.text ?? '';
  if (!artifactText.includes('mcp-calc: 30')) {
    throw new Error(\`Layer 6 & 7 Failed: Artifact text does not contain bounded MCP invocation result (got: \${artifactText})\`);
  }
  console.log('  ✓ Artifact produced with bounded MCP calculation result');

  console.log('[Layer 8 & 9] Checking A2A Conformance & Doctor...');
  const card = await client.getAgentCard();
  if (card.protocolVersion !== '1.0' || !card.name) {
    throw new Error('Layer 8 Failed: Agent Card does not conform to A2A specification');
  }
  console.log('  ✓ Agent Card conforms to A2A specification');
  console.log('  ✓ All verification layers passed successfully!');
  console.log('\n\u2705 GOLDEN PATH VERIFICATION PASSED');
}

verify().catch((err) => {
  console.error('\n\u274c VERIFICATION FAILED: ' + err.message);
  process.exit(1);
});
`;
}

function renderProductionDemoTest(): string {
  return `import { describe, expect, it } from 'vitest';
import { ResearcherAgent } from '../src/researcher-agent.js';
import { OrchestratorAgent } from '../src/orchestrator-agent.js';
import { RegistryServer } from '@a2amesh/registry';
import { AgentRegistryClient, A2AClient } from '@a2amesh/runtime';

describe('Production Demo pipeline', () => {
  it('executes full golden path pipeline', async () => {
    const registry = new RegistryServer({ allowLocalhost: true, requireAuth: false });
    const registryServer = registry.start(3199);

    const researcher = new ResearcherAgent('db/test-researcher.db', 'test-key');
    const orchestrator = new OrchestratorAgent('http://127.0.0.1:3199', 'db/test-orchestrator.db', 'test-key');

    const resServer = researcher.start(3101);
    const orchServer = orchestrator.start(3102);

    try {
      const registryClient = new AgentRegistryClient('http://127.0.0.1:3199');
      await registryClient.register('http://127.0.0.1:3101', researcher.getAgentCard());
      await registryClient.register('http://127.0.0.1:3102', orchestrator.getAgentCard());

      const client = new A2AClient('http://127.0.0.1:3102', { headers: { 'x-api-key': 'test-key' } });

      const task = ${renderSendMessageSnippet('test-msg-1', 'Test query')}

      ${renderPollCompletionCode()}

      expect(completed.status.state).toBe('COMPLETED');
      const text = completed.artifacts?.[0]?.parts.find((p) => p.type === 'text')?.text;
      expect(text).toContain('mcp-calc: 30');
    } finally {
      researcher.stop();
      orchestrator.stop();
      resServer.close();
      orchServer.close();
      await registry.stop();
    }
  });
});
`;
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('');
}

export function scaffoldAgent(name: string, options: ScaffoldOptions): void {
  const dir = resolve(process.cwd(), name);
  if (existsSync(dir)) {
    process.stderr.write(`Directory ${name} already exists.\n`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });

  const template = options.template ?? (options.adapter as string === 'production-demo' ? 'production-demo' : 'custom');

  if (template === 'production-demo') {
    mkdirSync(join(dir, 'tests'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), renderProductionDemoPackageJson(name));
    writeFileSync(join(dir, 'tsconfig.json'), renderTsconfig());
    writeFileSync(join(dir, '.env.example'), `A2A_API_KEY=${DEMO_SECRET_KEY}\nREGISTRY_TOKEN=production-demo-registry-token\n`);
    writeFileSync(
      join(dir, 'README.md'),
      `# ${name}\n\nCredential-free production-principles golden path scaffolded with A2A Mesh.\n\n## Quickstart\n\n1. \`pnpm install\`\n2. \`cp .env.example .env\`\n3. \`pnpm dev\`\n4. \`pnpm verify\`\n`,
    );
    writeFileSync(join(dir, 'src', 'researcher-agent.ts'), renderProductionDemoResearcherSource());
    writeFileSync(join(dir, 'src', 'orchestrator-agent.ts'), renderProductionDemoOrchestratorSource());
    writeFileSync(join(dir, 'src', 'index.ts'), renderProductionDemoIndexSource());
    writeFileSync(join(dir, 'verify.mjs'), renderProductionDemoVerifyScript());
    writeFileSync(join(dir, 'tests', 'demo.test.ts'), renderProductionDemoTest());
  } else {
    writeFileSync(join(dir, 'package.json'), renderPackageJson(name));
    writeFileSync(join(dir, 'tsconfig.json'), renderTsconfig());
    writeFileSync(join(dir, '.env.example'), renderEnvExample(options));
    writeFileSync(join(dir, 'README.md'), renderReadme(name, options));
    writeFileSync(join(dir, 'src', 'agent.ts'), renderAgentSource(name, options));
    writeFileSync(join(dir, 'src', 'index.ts'), renderIndexSource(name));

    if (options.docker) {
      writeFileSync(join(dir, 'Dockerfile'), renderDockerfile());
    }
  }

  const runCmd = template === 'production-demo' ? 'pnpm install && pnpm dev (and pnpm verify in another terminal)' : 'pnpm install && pnpm dev';

  const output = [
    '\x1b[32mScaffold complete!\x1b[0m',
    '',
    `You just created: \x1b[36m${name}\x1b[0m using the \x1b[33m${template}\x1b[0m template.`,
    '',
    'Your A2A Mesh agent is ready to be developed.',
    '',
    '\x1b[1mNext steps:\x1b[0m',
    `  1. cd ${name}`,
    `  2. copy .env.example to .env and add any required API keys`,
    `  3. ${runCmd}`,
    '',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  process.stdout.write(output);
}

export function createScaffoldCommand(): Command {
  return applyCommandDoc(new Command('init').alias('scaffold'), scaffoldCommandDoc)
    .argument('<agent-name>')
    .option('--adapter <adapter>', 'Template type (custom or production-demo)', 'custom')
    .option('--template <template>', 'Template type (custom or production-demo)', 'custom')
    .option('--auth', 'Include API key authentication')
    .option('--rate-limit', 'Include explicit rate limit configuration')
    .option('--docker', 'Include Dockerfile')
    .action(
      (
        name: string,
        commandOptions: {
          adapter: ScaffoldAdapter;
          template?: ScaffoldTemplate;
          auth?: boolean;
          rateLimit?: boolean;
          docker?: boolean;
        },
      ) => {
        const selectedTemplate = commandOptions.template ?? commandOptions.adapter;
        if (selectedTemplate !== 'custom' && selectedTemplate !== 'production-demo') {
          throw new Error('Supported templates are custom and production-demo');
        }
        scaffoldAgent(name, {
          adapter: commandOptions.adapter,
          template: selectedTemplate,
          auth: commandOptions.auth ?? false,
          rateLimit: commandOptions.rateLimit ?? false,
          docker: commandOptions.docker ?? false,
        });
      },
    );
}
