import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SKILLS = ['a2a-endpoint-validation', 'a2a-task-operations', 'a2a-mcp-consumption'];
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

class EvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluationError';
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new EvaluationError(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function redact(value, secret) {
  if (!secret) return value;
  return value.split(secret).join('[REDACTED]');
}

function parseEvents(raw, skill) {
  const events = [];
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new EvaluationError(
        `OpenCode returned non-JSON output for ${skill} at line ${index + 1}.`,
      );
    }
  }
  return events;
}

function validateEvents(events, skill) {
  const providerErrors = events.filter((event) => event?.type === 'error');
  if (providerErrors.length > 0) {
    throw new EvaluationError(`OpenCode reported a provider error for ${skill}.`);
  }

  const toolEvents = events.filter((event) => event?.type === 'tool_use');
  if (toolEvents.length !== 1) {
    throw new EvaluationError(
      `Expected exactly one completed skill tool call for ${skill}; observed ${toolEvents.length}.`,
    );
  }

  const toolPart = toolEvents[0]?.part;
  if (
    toolPart?.tool !== 'skill' ||
    toolPart?.state?.status !== 'completed' ||
    toolPart?.state?.input?.name !== skill
  ) {
    throw new EvaluationError(`OpenCode did not load the expected skill: ${skill}.`);
  }

  const text = events
    .filter((event) => event?.type === 'text' && typeof event?.part?.text === 'string')
    .map((event) => event.part.text)
    .join('\n');
  const expectedMarker = `SKILL_OK ${skill}`;
  if (!text.includes(expectedMarker)) {
    throw new EvaluationError(`OpenCode did not emit the expected completion marker for ${skill}.`);
  }

  return {
    skill,
    tool: toolPart.tool,
    toolStatus: toolPart.state.status,
    marker: expectedMarker,
  };
}

async function main() {
  const apiKey = requiredEnvironment('OPENCODE_ZEN_API_KEY');
  const model = requiredEnvironment('OPENCODE_ZEN_MODEL');
  const opencodeBinary = requiredEnvironment('OPENCODE_BIN');
  const outputDirectory = path.resolve(
    process.env.OPENCODE_EVALUATION_OUTPUT ?? 'artifacts/provider-live-smoke/opencode',
  );

  if (!MODEL_ID_PATTERN.test(model)) {
    throw new EvaluationError('OPENCODE_ZEN_MODEL contains unsupported characters.');
  }
  if (!path.isAbsolute(opencodeBinary)) {
    throw new EvaluationError('OPENCODE_BIN must be an absolute path.');
  }
  await access(opencodeBinary, fsConstants.X_OK);

  const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  for (const skill of SKILLS) {
    await access(path.join(repositoryRoot, '.opencode', 'skills', skill, 'SKILL.md'));
  }

  await mkdir(outputDirectory, { recursive: true });
  const isolatedHome = await mkdtemp(path.join(tmpdir(), 'a2amesh-opencode-'));
  const configPath = path.join(isolatedHome, 'opencode.json');
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'zen-ci': {
        npm: '@ai-sdk/openai-compatible',
        name: 'OpenCode Zen CI',
        options: {
          baseURL: 'https://opencode.ai/zen/v1',
          apiKey: '{env:OPENCODE_ZEN_API_KEY}',
        },
        models: {
          [model]: { name: `OpenCode Zen ${model}` },
        },
      },
    },
    permission: {
      '*': 'deny',
      skill: { '*': 'allow' },
    },
  };

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    const results = [];

    for (const skill of SKILLS) {
      const prompt = [
        `Load the skill named ${skill} using the skill tool.`,
        'Do not use any other tool and do not access the network.',
        `After reading the skill, return exactly: SKILL_OK ${skill}`,
      ].join(' ');
      const execution = spawnSync(
        opencodeBinary,
        [
          'run',
          '--pure',
          '--format',
          'json',
          '--model',
          `zen-ci/${model}`,
          '--dir',
          repositoryRoot,
          '--title',
          `A2A Mesh skill evaluation: ${skill}`,
          prompt,
        ],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: {
            CI: 'true',
            HOME: isolatedHome,
            PATH: process.env.PATH,
            XDG_CACHE_HOME: path.join(isolatedHome, 'cache'),
            XDG_CONFIG_HOME: path.join(isolatedHome, 'config'),
            XDG_DATA_HOME: path.join(isolatedHome, 'data'),
            OPENCODE_CONFIG: configPath,
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            OPENCODE_DISABLE_PRUNE: '1',
            OPENCODE_AUTO_SHARE: 'false',
            OPENCODE_ZEN_API_KEY: apiKey,
          },
          maxBuffer: MAX_OUTPUT_BYTES,
          timeout: RUN_TIMEOUT_MS,
          windowsHide: true,
        },
      );

      const stdout = redact(execution.stdout ?? '', apiKey);
      const stderr = redact(execution.stderr ?? '', apiKey);
      await writeFile(path.join(outputDirectory, `${skill}.jsonl`), stdout, { mode: 0o600 });

      if (execution.error?.code === 'ETIMEDOUT') {
        throw new EvaluationError(`OpenCode timed out while evaluating ${skill}.`);
      }
      if (execution.error) {
        throw new EvaluationError(`OpenCode could not start while evaluating ${skill}.`);
      }
      if (execution.status !== 0) {
        await writeFile(path.join(outputDirectory, `${skill}.stderr.txt`), stderr, { mode: 0o600 });
        throw new EvaluationError(`OpenCode exited unsuccessfully while evaluating ${skill}.`);
      }

      const events = parseEvents(stdout, skill);
      results.push(validateEvents(events, skill));
      process.stdout.write(`Validated OpenCode skill: ${skill}\n`);
    }

    const summary = {
      schemaVersion: 1,
      provider: 'opencode-zen',
      model,
      evaluatedAt: new Date().toISOString(),
      permissions: { default: 'deny', allowed: ['skill'] },
      results,
    };
    await writeFile(
      path.join(outputDirectory, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
  } finally {
    await rm(isolatedHome, { force: true, recursive: true });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'OpenCode skill evaluation failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
