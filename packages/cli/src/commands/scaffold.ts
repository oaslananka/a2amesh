import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { scaffoldTemplateConfig } from '../generated/scaffold-template.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const scaffoldCommandDoc = {
  path: ['init'],
  summary: 'Initialize an A2A Mesh agent project.',
  description:
    'Creates a new A2A Mesh agent project from the stable runtime template, with optional auth, rate limiting, and Dockerfile output.',
  examples: [
    {
      title: 'Initialize an agent project.',
      bash: ['a2amesh init demo-agent'],
      powershell: ['a2amesh init demo-agent'],
    },
    {
      title: 'Initialize an agent with auth and Docker support.',
      bash: ['a2amesh init secure-agent --auth --docker'],
      powershell: ['a2amesh init secure-agent --auth --docker'],
    },
  ],
} satisfies CliCommandDoc;

type ScaffoldAdapter = 'custom';

export interface ScaffoldOptions {
  adapter: ScaffoldAdapter;
  auth: boolean;
  rateLimit: boolean;
  docker: boolean;
}

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

process.stdout.write('Agent ${name} listening on port 3000\\n');
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

  writeFileSync(join(dir, 'package.json'), renderPackageJson(name));
  writeFileSync(join(dir, 'tsconfig.json'), renderTsconfig());
  writeFileSync(join(dir, '.env.example'), renderEnvExample(options));
  writeFileSync(join(dir, 'README.md'), renderReadme(name, options));
  writeFileSync(join(dir, 'src', 'agent.ts'), renderAgentSource(name, options));
  writeFileSync(join(dir, 'src', 'index.ts'), renderIndexSource(name));

  if (options.docker) {
    writeFileSync(join(dir, 'Dockerfile'), renderDockerfile());
  }

  const runCmd = 'pnpm install && pnpm dev';

  const output = [
    '\x1b[32mScaffold complete!\x1b[0m',
    '',
    `You just created: \x1b[36m${name}\x1b[0m using the \x1b[33m${options.adapter}\x1b[0m template.`,
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
    .option('--adapter <adapter>', 'Template type (custom is the stable alpha option)', 'custom')
    .option('--auth', 'Include API key authentication')
    .option('--rate-limit', 'Include explicit rate limit configuration')
    .option('--docker', 'Include Dockerfile')
    .action(
      (
        name: string,
        commandOptions: {
          adapter: ScaffoldAdapter;
          auth?: boolean;
          rateLimit?: boolean;
          docker?: boolean;
        },
      ) => {
        if (commandOptions.adapter !== 'custom') {
          throw new Error('Provider adapter templates are internal during the first alpha');
        }
        scaffoldAgent(name, {
          adapter: commandOptions.adapter,
          auth: commandOptions.auth ?? false,
          rateLimit: commandOptions.rateLimit ?? false,
          docker: commandOptions.docker ?? false,
        });
      },
    );
}
