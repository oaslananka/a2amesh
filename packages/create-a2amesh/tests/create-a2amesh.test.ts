import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.js';
import type { spawnSync } from 'node:child_process';

const runtimeVersions = JSON.parse(
  await readFile(new URL('../../../tools/runtime-versions.json', import.meta.url), 'utf8'),
) as { node: string; pnpm: string; npmForPublish: string; nodeCompatibility: string[] };

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const createBinary = resolve(repoRoot, 'packages/create-a2amesh/bin/create-a2amesh.js');
const nodeCommand = 'node';
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

type ScaffoldAdapter =
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'langchain'
  | 'pack-research-team'
  | 'pack-support-triage';

interface TemplateExpectation {
  adapter: ScaffoldAdapter;
  name: string;
  args?: string[];
  packageDependency: string;
  sourceMarker: string;
  envMarker?: string;
  docker?: boolean;
}

interface LocalPackageOverride {
  name: string;
  specifier: string;
}

const localPackageDirs = [
  ['@a2amesh/runtime', 'packages/runtime'],
  ['@a2amesh/protocol', 'packages/protocol'],
  ['@a2amesh/internal-adapter-base', 'packages/adapter-base'],
  ['@a2amesh/internal-adapters', 'packages/adapters'],
  ['@a2amesh/internal-adapter-openai', 'packages/adapter-openai'],
  ['@a2amesh/internal-adapter-anthropic', 'packages/adapter-anthropic'],
  ['@a2amesh/internal-adapter-langchain', 'packages/adapter-langchain'],
  ['@a2amesh/internal-adapter-google-adk', 'packages/adapter-google-adk'],
  ['@a2amesh/internal-adapter-llamaindex', 'packages/adapter-llamaindex'],
  ['@a2amesh/internal-adapter-crewai', 'packages/adapter-crewai'],
  ['@a2amesh/registry', 'packages/registry'],
  ['@a2amesh/internal-auth', 'packages/auth'],
  ['@a2amesh/internal-telemetry', 'packages/telemetry'],
] as const;

const templates: TemplateExpectation[] = [
  {
    adapter: 'custom',
    name: 'custom-agent',
    args: ['--auth', '--rate-limit', '--docker'],
    packageDependency: '@a2amesh/runtime',
    sourceMarker: 'A2AServer',
    envMarker: 'A2A_API_KEY=your-secure-api-key-here',
    docker: true,
  },
];

async function execIn(
  cwd: string,
  command: typeof nodeCommand | typeof pnpmCommand,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const file = command === 'pnpm.cmd' ? 'cmd.exe' : command;
  const commandArgs = command === 'pnpm.cmd' ? ['/d', '/s', '/c', command, ...args] : [...args];
  try {
    return await execFileAsync(file, commandArgs, {
      cwd,
      env: {
        ...process.env,
        CI: 'true',
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch (error) {
    const failure = error as Error & { stderr?: string; stdout?: string };
    const message = [
      `Command failed in ${cwd}: ${command} ${args.join(' ')}`,
      failure.stdout ? `stdout:\n${failure.stdout}` : '',
      failure.stderr ? `stderr:\n${failure.stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    throw new Error(message, { cause: error });
  }
}

function parsePackFilename(output: string): string {
  const payload = JSON.parse(output) as { filename?: string } | Array<{ filename?: string }>;
  const result = Array.isArray(payload) ? payload[0] : payload;
  if (typeof result?.filename !== 'string') {
    throw new Error('pnpm pack --json did not report a tarball filename');
  }
  return result.filename;
}

async function packLocalPackageOverrides(tempDir: string): Promise<LocalPackageOverride[]> {
  const tarballDir = join(tempDir, 'tarballs');
  await mkdir(tarballDir, { recursive: true });

  const overrides: LocalPackageOverride[] = [];
  for (const [name, packageDir] of localPackageDirs) {
    const { stdout } = await execIn(repoRoot, pnpmCommand, [
      '--dir',
      resolve(repoRoot, packageDir),
      'pack',
      '--json',
      '--pack-destination',
      tarballDir,
    ]);
    overrides.push({
      name,
      specifier: `file:../tarballs/${basename(parsePackFilename(stdout))}`,
    });
  }
  return overrides;
}

async function writeLocalPackageOverrides(
  projectDir: string,
  overrides: LocalPackageOverride[],
): Promise<void> {
  const lines = ['packages: []', 'overrides:'];
  for (const override of overrides) {
    lines.push(`  ${JSON.stringify(override.name)}: ${JSON.stringify(override.specifier)}`);
  }
  await writeFile(join(projectDir, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`);
}

async function readProjectFile(projectDir: string, path: string): Promise<string> {
  return readFile(join(projectDir, path), 'utf8');
}

describe('create-a2amesh runner', () => {
  it('forwards arguments to the CLI init command and returns its status', () => {
    const spawn = vi.fn(() => ({ status: 0 }));

    const status = run({
      args: ['demo-agent', '--adapter', 'custom'],
      env: { A2AMESH_TEST: '1' },
      spawn: spawn as unknown as typeof spawnSync,
    });

    expect(status).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining('cli'), 'init', 'demo-agent', '--adapter', 'custom'],
      {
        stdio: 'inherit',
        env: { A2AMESH_TEST: '1' },
      },
    );
  });

  it('writes spawn errors and returns a failing status when the CLI cannot start', () => {
    const stderr = { write: vi.fn(() => true) };
    const spawn = vi.fn(() => ({
      status: null,
      error: new Error('spawn failed'),
    }));

    const status = run({
      args: ['demo-agent'],
      cliEntry: '/tmp/missing-cli.js',
      spawn: spawn as unknown as typeof spawnSync,
      stderr,
    });

    expect(status).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith('spawn failed\n');
  });
});

describe('create-a2amesh binary scaffolds typechecked templates', () => {
  it('generates every adapter template in temporary directories', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'create-a2amesh-'));
    const localPackageOverrides = await packLocalPackageOverrides(tempDir);

    for (const template of templates) {
      await execIn(tempDir, nodeCommand, [
        createBinary,
        template.name,
        '--adapter',
        template.adapter,
        ...(template.args ?? []),
      ]);

      const projectDir = join(tempDir, template.name);
      await writeLocalPackageOverrides(projectDir, localPackageOverrides);

      const packageJson = await readProjectFile(projectDir, 'package.json');
      const tsconfigJson = await readProjectFile(projectDir, 'tsconfig.json');
      const readme = await readProjectFile(projectDir, 'README.md');
      const envExample = await readProjectFile(projectDir, '.env.example');
      const agentSource = await readProjectFile(projectDir, 'src/agent.ts');
      const indexSource = await readProjectFile(projectDir, 'src/index.ts');

      expect(packageJson).toContain(`"${template.packageDependency}"`);
      expect(packageJson).toContain(`"packageManager": "pnpm@${runtimeVersions.pnpm}"`);
      expect(tsconfigJson).toContain('"module": "NodeNext"');
      expect(readme).toContain(`- Adapter: \`${template.adapter}\``);
      expect(agentSource).toContain(template.sourceMarker);
      expect(indexSource).toContain('process.stdout.write');
      if (template.envMarker) {
        expect(envExample).toContain(template.envMarker);
      }
      if (template.docker) {
        expect(await readProjectFile(projectDir, 'Dockerfile')).toContain('pnpm install');
      }

      await execIn(projectDir, pnpmCommand, ['install', '--lockfile-only']);
      await stat(join(projectDir, 'pnpm-lock.yaml'));
      await execIn(projectDir, pnpmCommand, ['install', '--frozen-lockfile', '--ignore-scripts']);
      await execIn(projectDir, pnpmCommand, ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']);
    }
  }, 240_000);
});
