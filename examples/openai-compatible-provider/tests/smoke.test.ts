import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProviderExampleError,
  readProviderConfig,
  runExample,
  runLiveSmoke,
  type OpenAICompatibleClientFactory,
  type OpenAICompatibleClientOptions,
  type OpenAICompatibleRequest,
} from '../src/index.js';

const baseEnvironment = {
  A2AMESH_OPENAI_COMPAT_BASE_URL: 'https://provider-a.example/v1',
  A2AMESH_OPENAI_COMPAT_API_KEY: 'unit-test-api-key',
  A2AMESH_OPENAI_COMPAT_MODEL: 'provider-a/model-alpha',
  A2AMESH_OPENAI_COMPAT_PROFILE: 'provider-a',
  A2AMESH_OPENAI_COMPAT_TIMEOUT_MS: '2500',
  A2AMESH_OPENAI_COMPAT_MAX_TOKENS: '96',
  A2AMESH_OPENAI_COMPAT_TEMPERATURE: '0.25',
  A2AMESH_OPENAI_COMPAT_SUPPORTS_STREAMING: 'true',
  A2AMESH_OPENAI_COMPAT_SUPPORTS_TOOL_CALLING: 'false',
} as const;

function createRecordingFactory(options?: { responseText?: string; failure?: unknown }): {
  factory: OpenAICompatibleClientFactory;
  constructorOptions: OpenAICompatibleClientOptions[];
  requests: OpenAICompatibleRequest[];
} {
  const constructorOptions: OpenAICompatibleClientOptions[] = [];
  const requests: OpenAICompatibleRequest[] = [];
  const factory: OpenAICompatibleClientFactory = (clientOptions) => {
    constructorOptions.push(clientOptions);
    return {
      chat: {
        completions: {
          create: async (request) => {
            requests.push(request);
            if (options?.failure !== undefined) {
              throw options.failure;
            }
            return {
              choices: [
                {
                  message: {
                    content: options?.responseText ?? 'fake provider response',
                  },
                },
              ],
            };
          },
        },
      },
    };
  };
  return { factory, constructorOptions, requests };
}

void test('switches OpenAI-compatible providers through environment configuration only', async () => {
  const first = createRecordingFactory({ responseText: 'provider a response' });
  const firstResult = await runExample({ env: baseEnvironment, clientFactory: first.factory });

  const second = createRecordingFactory({ responseText: 'provider b response' });
  const secondResult = await runExample({
    env: {
      ...baseEnvironment,
      A2AMESH_OPENAI_COMPAT_BASE_URL: 'https://provider-b.example/api/v1',
      A2AMESH_OPENAI_COMPAT_MODEL: 'provider-b/model-beta',
      A2AMESH_OPENAI_COMPAT_PROFILE: 'provider-b',
    },
    clientFactory: second.factory,
  });

  assert.deepEqual(first.constructorOptions, [
    {
      apiKey: 'unit-test-api-key',
      baseURL: 'https://provider-a.example/v1',
      timeout: 2500,
    },
  ]);
  assert.equal(first.requests[0]?.model, 'provider-a/model-alpha');
  assert.equal(second.constructorOptions[0]?.baseURL, 'https://provider-b.example/api/v1');
  assert.equal(second.requests[0]?.model, 'provider-b/model-beta');
  assert.equal(firstResult.profile, 'provider-a');
  assert.equal(secondResult.profile, 'provider-b');
  assert.equal(firstResult.text, 'provider a response');
  assert.equal(secondResult.text, 'provider b response');
  assert.equal(JSON.stringify(firstResult).includes('unit-test-api-key'), false);
});

void test('default smoke path uses a fake client and never calls fetch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network access is forbidden in the default smoke path');
  };

  try {
    const result = await runExample({ env: baseEnvironment });
    assert.equal(result.mode, 'openai-compatible-fake');
    assert.equal(result.text, 'fake OpenAI-compatible response');
    assert.deepEqual(result.requestSettings, { maxTokens: 96, temperature: 0.25 });
    assert.deepEqual(result.capabilities, {
      provider: { streaming: 'supported', toolCalling: 'unsupported' },
      adapter: { streaming: 'unsupported', toolCalling: 'unsupported' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('merges optional request settings without changing the adapter contract', async () => {
  const recording = createRecordingFactory();
  await runExample({ env: baseEnvironment, clientFactory: recording.factory });

  assert.deepEqual(recording.requests[0], {
    model: 'provider-a/model-alpha',
    messages: [{ role: 'user', content: 'Confirm OpenAI-compatible provider connectivity.' }],
    max_tokens: 96,
    temperature: 0.25,
  });
});

void test('classifies rate limits and timeouts without exposing credentials', async () => {
  const rateLimited = createRecordingFactory({
    failure: {
      status: 429,
      message: `rate limited for ${baseEnvironment.A2AMESH_OPENAI_COMPAT_API_KEY}`,
    },
  });

  await assert.rejects(
    runExample({ env: baseEnvironment, clientFactory: rateLimited.factory }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderExampleError);
      assert.equal(error.message, 'Provider rate limited the request (HTTP 429).');
      assert.equal(error.message.includes(baseEnvironment.A2AMESH_OPENAI_COMPAT_API_KEY), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );

  const timedOut = createRecordingFactory({
    failure: {
      name: 'APIConnectionTimeoutError',
      message: `timeout with ${baseEnvironment.A2AMESH_OPENAI_COMPAT_API_KEY}`,
    },
  });

  await assert.rejects(
    runExample({ env: baseEnvironment, clientFactory: timedOut.factory }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderExampleError);
      assert.equal(error.message, 'Provider request timed out after 2500 ms.');
      assert.equal(error.message.includes(baseEnvironment.A2AMESH_OPENAI_COMPAT_API_KEY), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

void test('live smoke fails closed before creating a client unless explicitly enabled', async () => {
  let factoryCalls = 0;
  const clientFactory: OpenAICompatibleClientFactory = () => {
    factoryCalls += 1;
    throw new Error('client factory must not be called');
  };

  await assert.rejects(
    runLiveSmoke({ env: baseEnvironment, clientFactory }),
    /A2AMESH_OPENAI_COMPAT_LIVE=1/u,
  );
  assert.equal(factoryCalls, 0);
});

void test('configuration errors name variables without echoing their values', () => {
  assert.throws(
    () => readProviderConfig({ A2AMESH_OPENAI_COMPAT_API_KEY: 'do-not-print-me' }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderExampleError);
      assert.match(error.message, /A2AMESH_OPENAI_COMPAT_BASE_URL/u);
      assert.equal(error.message.includes('do-not-print-me'), false);
      return true;
    },
  );
});
