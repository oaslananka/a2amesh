import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { OpenAIAdapter } from '@a2amesh/internal-adapter-openai';
import type { AnyAgentCard, Message, Task } from '@a2amesh/runtime';
import {
  runConfiguredFleetProvider,
  type OpenAICompatibleFleetExampleResult,
} from './fleet-example.js';

type Environment = Readonly<Record<string, string | undefined>>;
type ProviderCapabilityState = 'supported' | 'unsupported' | 'unknown';
type AdapterClient = ConstructorParameters<typeof OpenAIAdapter>[1];

export interface OpenAICompatibleClientOptions {
  apiKey: string;
  baseURL: string;
  timeout: number;
}

export interface OpenAICompatibleRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAICompatibleClient {
  chat: {
    completions: {
      create(
        request: OpenAICompatibleRequest,
        options?: { signal?: AbortSignal },
      ): Promise<{
        choices: Array<{ message: { content: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>;
    };
  };
}

export type OpenAICompatibleClientFactory = (
  options: OpenAICompatibleClientOptions,
) => OpenAICompatibleClient;

export interface ProviderConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  profile: string;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  providerStreaming: ProviderCapabilityState;
  providerToolCalling: ProviderCapabilityState;
}

export interface ProviderExampleResult {
  mode: 'openai-compatible-fake' | 'openai-compatible-live';
  profile: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  requestSettings: { maxTokens?: number; temperature?: number };
  capabilities: {
    provider: {
      streaming: ProviderCapabilityState;
      toolCalling: ProviderCapabilityState;
    };
    adapter: {
      streaming: 'unsupported';
      toolCalling: 'unsupported';
    };
  };
  text: string;
}

interface RunOptions {
  env: Environment;
  clientFactory?: OpenAICompatibleClientFactory;
}

interface LiveRunOptions {
  env: Environment;
  clientFactory: OpenAICompatibleClientFactory;
}

export class ProviderExampleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderExampleError';
  }
}

export function readProviderConfig(env: Environment): ProviderConfig {
  const baseURL = readRequired(env, 'A2AMESH_OPENAI_COMPAT_BASE_URL');
  const apiKey = readRequired(env, 'A2AMESH_OPENAI_COMPAT_API_KEY');
  const model = readRequired(env, 'A2AMESH_OPENAI_COMPAT_MODEL');
  const profile = readOptional(env, 'A2AMESH_OPENAI_COMPAT_PROFILE') ?? 'custom';
  const timeoutMs = readPositiveInteger(env, 'A2AMESH_OPENAI_COMPAT_TIMEOUT_MS') ?? 30_000;
  const maxTokens = readPositiveInteger(env, 'A2AMESH_OPENAI_COMPAT_MAX_TOKENS');
  const temperature = readOptionalNumber(env, 'A2AMESH_OPENAI_COMPAT_TEMPERATURE', {
    minimum: 0,
    maximum: 2,
  });

  validateBaseURL(baseURL);

  return {
    apiKey,
    baseURL: removeTrailingSlash(baseURL),
    model,
    profile,
    timeoutMs,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(temperature === undefined ? {} : { temperature }),
    providerStreaming: readCapability(env, 'A2AMESH_OPENAI_COMPAT_SUPPORTS_STREAMING'),
    providerToolCalling: readCapability(env, 'A2AMESH_OPENAI_COMPAT_SUPPORTS_TOOL_CALLING'),
  };
}

export async function runFleetExample(
  options: RunOptions,
): Promise<OpenAICompatibleFleetExampleResult> {
  const config = readProviderConfig(options.env);
  const client = (options.clientFactory ?? createFakeClient)({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
  });
  return runConfiguredFleetProvider(config, client);
}

export async function runExample(options: RunOptions): Promise<ProviderExampleResult> {
  return runConfiguredProvider({
    env: options.env,
    clientFactory: options.clientFactory ?? createFakeClient,
    mode: 'openai-compatible-fake',
  });
}

export async function runLiveSmoke(options: LiveRunOptions): Promise<ProviderExampleResult> {
  if (options.env['A2AMESH_OPENAI_COMPAT_LIVE'] !== '1') {
    throw new ProviderExampleError(
      'Live provider smoke is disabled. Set A2AMESH_OPENAI_COMPAT_LIVE=1 explicitly.',
    );
  }

  return runConfiguredProvider({
    env: options.env,
    clientFactory: options.clientFactory,
    mode: 'openai-compatible-live',
  });
}

async function runConfiguredProvider(options: {
  env: Environment;
  clientFactory: OpenAICompatibleClientFactory;
  mode: ProviderExampleResult['mode'];
}): Promise<ProviderExampleResult> {
  const config = readProviderConfig(options.env);
  const rawClient = options.clientFactory({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
  });
  const configuredClient = addRequestSettings(rawClient, config);
  const adapter = new OpenAIAdapter(
    createAgentCard(config.profile),
    configuredClient as unknown as AdapterClient,
    config.model,
  );

  try {
    const artifacts = await adapter.handleTask(createTask(), createMessage());
    return {
      mode: options.mode,
      profile: config.profile,
      baseURL: config.baseURL,
      model: config.model,
      timeoutMs: config.timeoutMs,
      requestSettings: {
        ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
        ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
      },
      capabilities: {
        provider: {
          streaming: config.providerStreaming,
          toolCalling: config.providerToolCalling,
        },
        adapter: {
          streaming: 'unsupported',
          toolCalling: 'unsupported',
        },
      },
      text: readArtifactText(artifacts),
    };
  } catch (error) {
    throw new ProviderExampleError(formatProviderError(error, config.timeoutMs));
  }
}

function addRequestSettings(
  client: OpenAICompatibleClient,
  config: ProviderConfig,
): OpenAICompatibleClient {
  return {
    chat: {
      completions: {
        create: async (request) =>
          client.chat.completions.create({
            ...request,
            ...(config.maxTokens === undefined ? {} : { max_tokens: config.maxTokens }),
            ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
          }),
      },
    },
  };
}

function createFakeClient(): OpenAICompatibleClient {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'fake OpenAI-compatible response' } }],
        }),
      },
    },
  };
}

function createAgentCard(profile: string): AnyAgentCard {
  return {
    protocolVersion: '1.0',
    name: `OpenAI-Compatible Provider (${profile})`,
    description: 'Provider-neutral OpenAI-compatible adapter example.',
    url: 'http://127.0.0.1:0',
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
  };
}

function createTask(): Task {
  return {
    id: 'openai-compatible-provider-task',
    status: { state: 'WORKING', timestamp: new Date().toISOString() },
    history: [],
  };
}

function createMessage(): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text: 'Confirm OpenAI-compatible provider connectivity.' }],
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

function readArtifactText(artifacts: Awaited<ReturnType<OpenAIAdapter['handleTask']>>): string {
  const firstArtifact = artifacts[0];
  if (!firstArtifact) {
    throw new Error('OpenAI-compatible adapter did not return an artifact');
  }

  return firstArtifact.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

function formatProviderError(error: unknown, timeoutMs: number): string {
  const status = readErrorNumber(error, 'status');
  if (status === 429) {
    return 'Provider rate limited the request (HTTP 429).';
  }

  const name = readErrorString(error, 'name');
  const code = readErrorString(error, 'code');
  if (
    name?.toLowerCase().includes('timeout') === true ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return `Provider request timed out after ${timeoutMs} ms.`;
  }

  if (status !== undefined) {
    return `Provider request failed (HTTP ${status}).`;
  }

  return 'Provider request failed.';
}

function readRequired(env: Environment, name: string): string {
  const value = readOptional(env, name);
  if (!value) {
    throw new ProviderExampleError(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function readOptional(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function readPositiveInteger(env: Environment, name: string): number | undefined {
  const value = readOptional(env, name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ProviderExampleError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readOptionalNumber(
  env: Environment,
  name: string,
  bounds: { minimum: number; maximum: number },
): number | undefined {
  const value = readOptional(env, name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < bounds.minimum || parsed > bounds.maximum) {
    throw new ProviderExampleError(
      `${name} must be between ${bounds.minimum} and ${bounds.maximum}.`,
    );
  }
  return parsed;
}

function readCapability(env: Environment, name: string): ProviderCapabilityState {
  const value = readOptional(env, name)?.toLowerCase();
  if (value === undefined || value === 'unknown') {
    return 'unknown';
  }
  if (value === 'true') {
    return 'supported';
  }
  if (value === 'false') {
    return 'unsupported';
  }
  throw new ProviderExampleError(`${name} must be true, false, or unknown.`);
}

function validateBaseURL(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderExampleError('A2AMESH_OPENAI_COMPAT_BASE_URL must be a valid URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ProviderExampleError('A2AMESH_OPENAI_COMPAT_BASE_URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new ProviderExampleError(
      'A2AMESH_OPENAI_COMPAT_BASE_URL must not contain embedded credentials.',
    );
  }
  if (url.search || url.hash) {
    throw new ProviderExampleError(
      'A2AMESH_OPENAI_COMPAT_BASE_URL must not contain a query string or fragment.',
    );
  }
}

function removeTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function readErrorString(error: unknown, key: string): string | undefined {
  if (typeof error !== 'object' || error === null || !(key in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readErrorNumber(error: unknown, key: string): number | undefined {
  if (typeof error !== 'object' || error === null || !(key in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = await runExample({ env: process.env });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'Provider example failed.');
    process.exitCode = 1;
  }
}
