import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../..');
const evaluator = path.join(repoRoot, 'scripts/run-opencode-skill-evaluation.mjs');
const temporaryDirectories: string[] = [];

async function createFakeOpenCode(options: { unexpectedTool?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'a2amesh-fake-opencode-'));
  temporaryDirectories.push(root);
  const binary = path.join(root, 'opencode');
  const tool = options.unexpectedTool ? 'bash' : 'skill';
  await writeFile(
    binary,
    `#!/usr/bin/env node
const prompt = process.argv.at(-1) ?? '';
const skill = prompt.match(/skill named ([a-z0-9-]+)/u)?.[1] ?? 'unknown';
process.stdout.write(JSON.stringify({
  type: 'tool_use',
  part: {
    tool: '${tool}',
    state: {
      status: 'completed',
      input: { name: skill },
    },
  },
}) + '\\n');
process.stdout.write(JSON.stringify({
  type: 'text',
  part: { text: 'SKILL_OK ' + skill },
}) + '\\n');
process.stdout.write(JSON.stringify({
  type: 'step_finish',
  part: {
    type: 'step-finish',
    reason: 'stop',
    cost: 0.001,
    tokens: {
      total: 15,
      input: 10,
      output: 5,
      reasoning: 0,
      cache: { read: 2, write: 1 },
    },
  },
}) + '\\n');
`,
  );
  await chmod(binary, 0o755);
  return binary;
}

async function runEvaluator(binary: string, outputDirectory: string) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [evaluator], {
      cwd: repoRoot,
      env: {
        PATH: process.env['PATH'],
        OPENCODE_BIN: binary,
        OPENCODE_EVALUATION_OUTPUT: outputDirectory,
        OPENCODE_ZEN_API_KEY: 'synthetic-provider-secret',
        OPENCODE_ZEN_MODEL: 'nemotron-3-ultra-free',
      },
      timeout: 15_000,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof result.code === 'number' ? result.code : 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.skipIf(process.platform === 'win32')('manual provider live smoke evaluator', () => {
  it('loads exactly the three repository-owned skills with a default-deny tool policy', async () => {
    const binary = await createFakeOpenCode();
    const outputDirectory = await mkdtemp(path.join(tmpdir(), 'a2amesh-opencode-report-'));
    temporaryDirectories.push(outputDirectory);

    const result = await runEvaluator(binary, outputDirectory);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.match(/Validated OpenCode skill:/gu)).toHaveLength(3);
    const summary = JSON.parse(
      await readFile(path.join(outputDirectory, 'summary.json'), 'utf8'),
    ) as {
      permissions: { default: string; allowed: string[] };
      results: Array<{
        skill: string;
        tool: string;
        toolStatus: string;
        verifiedCompletion: boolean;
        toolCallCount: number;
        retryCount: number;
        durationMs: number;
        usage: {
          available: boolean;
          costUsd: number | null;
          tokens: {
            total: number | null;
            input: number | null;
            output: number | null;
            reasoning: number | null;
            cacheRead: number | null;
            cacheWrite: number | null;
          };
        };
      }>;
      totals: {
        verifiedSkills: number;
        toolCallCount: number;
        retryCount: number;
        durationMs: number;
        usage: {
          available: boolean;
          costUsd: number | null;
          tokens: { total: number | null };
        };
      };
    };
    expect(summary.permissions).toEqual({ default: 'deny', allowed: ['skill'] });
    expect(summary.results).toEqual([
      expect.objectContaining({
        skill: 'a2a-endpoint-validation',
        tool: 'skill',
        toolStatus: 'completed',
        verifiedCompletion: true,
        toolCallCount: 1,
        retryCount: 0,
        usage: expect.objectContaining({ available: true, costUsd: 0.001 }),
      }),
      expect.objectContaining({
        skill: 'a2a-task-operations',
        tool: 'skill',
        toolStatus: 'completed',
        verifiedCompletion: true,
        toolCallCount: 1,
        retryCount: 0,
        usage: expect.objectContaining({ available: true, costUsd: 0.001 }),
      }),
      expect.objectContaining({
        skill: 'a2a-mcp-consumption',
        tool: 'skill',
        toolStatus: 'completed',
        verifiedCompletion: true,
        toolCallCount: 1,
        retryCount: 0,
        usage: expect.objectContaining({ available: true, costUsd: 0.001 }),
      }),
    ]);
    expect(summary.results.every((item) => item.durationMs >= 0)).toBe(true);
    expect(summary.totals).toEqual(
      expect.objectContaining({
        verifiedSkills: 3,
        toolCallCount: 3,
        retryCount: 0,
        usage: expect.objectContaining({ available: true, costUsd: 0.003 }),
      }),
    );
    expect(summary.totals.usage.tokens.total).toBe(45);
    expect(JSON.stringify(summary)).not.toContain('synthetic-provider-secret');
  });

  it('fails closed when a model attempts any tool other than skill', async () => {
    const binary = await createFakeOpenCode({ unexpectedTool: true });
    const outputDirectory = await mkdtemp(path.join(tmpdir(), 'a2amesh-opencode-report-'));
    temporaryDirectories.push(outputDirectory);

    const result = await runEvaluator(binary, outputDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('did not load the expected skill');
    expect(result.stderr).not.toContain('synthetic-provider-secret');
  });
});
