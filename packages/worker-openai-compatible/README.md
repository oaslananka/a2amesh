# @a2amesh/internal-worker-openai-compatible

Experimental A2A Mesh Fleet worker for text-only inference through a documented OpenAI-compatible provider API.

The package implements the complete `WorkerRuntimeContract` lifecycle and is intended for provider families such as NVIDIA NIM, OpenRouter-style endpoints, and OpenCode Zen when they expose an official OpenAI-compatible API. It is not tied to a specific provider account, base URL, or model.

## Security boundary

The worker:

- accepts a caller-created API client instead of raw credentials;
- permits `read-only` inference only;
- does not execute provider tools or remote side effects;
- applies bounded timeouts, concurrency, and response-size limits;
- classifies provider failures without returning raw provider error text;
- emits checksummed text artifacts and token-usage metadata;
- supports cancellation through `AbortSignal`;
- never uses browser sessions, web UI scraping, private endpoints, token extraction, or subscription bypass.

Create the provider client outside this package using credentials supplied by the deployment secret manager. Do not place credentials in Fleet task metadata, worker cards, artifacts, logs, or repository files.

## Example

```ts
import OpenAI from 'openai';
import { OpenAICompatibleWorkerRuntimeAdapter } from '@a2amesh/internal-worker-openai-compatible';

const client = new OpenAI({
  apiKey: process.env['PROVIDER_API_KEY'],
  baseURL: 'https://provider.example.com/v1',
});

const worker = new OpenAICompatibleWorkerRuntimeAdapter({
  id: 'provider-worker',
  providerId: 'documented-provider',
  model: 'provider/model',
  client,
  card: {
    protocolVersion: '1.0',
    name: 'Documented provider worker',
    description: 'Text-only official API worker.',
    url: 'https://worker.example.com',
    version: '1.0.0',
    fleetRoles: ['model-worker'],
  },
  policy: {
    timeoutMs: 30_000,
    maxConcurrentRuns: 1,
    maxOutputCharacters: 100_000,
  },
});
```

The `openai` SDK remains a caller dependency. This package only requires the small client contract described by `OpenAICompatibleWorkerClient`.

## Admission metadata

The worker recognizes two optional `WorkerRuntimeContext.metadata` fields:

- `sideEffectLevel`: omitted or `read-only`; any other value is denied.
- `requestedProviderTools`: a non-empty array is denied because this worker does not execute tools.

## Validation

```bash
pnpm --filter @a2amesh/internal-worker-openai-compatible run build
pnpm --filter @a2amesh/internal-worker-openai-compatible run typecheck
pnpm --filter @a2amesh/internal-worker-openai-compatible run test
```
