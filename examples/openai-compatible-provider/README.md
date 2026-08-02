# OpenAI-Compatible Provider Example

This example demonstrates both the existing private OpenAI adapter and the experimental OpenAI-compatible Fleet worker through one provider-neutral configuration path. It does not add a NVIDIA-specific adapter or make any provider the default.

The required smoke test uses an in-memory fake client. It performs no network request and needs no real credential. The Fleet path routes a text-generation task, runs the complete worker lifecycle, verifies a checksummed artifact, and cleans up the run. A separate live command is available only when explicitly enabled.

## What the example proves

- The API key, base URL, model identifier, timeout, and optional request settings come from environment variables.
- Switching between compatible providers does not require a source edit.
- The required smoke path cannot reach the network.
- Fleet capability routing selects the OpenAI-compatible worker and completes prepare, start, stream, verify, finalize, and cleanup.
- The Fleet result includes a SHA-256 checksummed text artifact without exposing credentials.
- Rate-limit and timeout failures produce bounded messages without echoing provider responses or credentials.
- Provider capability claims remain separate from the current adapter contract. The provider may support streaming or tool calling, while this internal adapter currently uses non-streaming text chat completions and does not expose tools.

## Required fake-client smoke

```bash
A2AMESH_OPENAI_COMPAT_BASE_URL=https://example.invalid/v1 \
A2AMESH_OPENAI_COMPAT_API_KEY=test-only-placeholder \
A2AMESH_OPENAI_COMPAT_MODEL=replace-with-model-id \
pnpm --dir examples/openai-compatible-provider run smoke
```

PowerShell:

```powershell
$env:A2AMESH_OPENAI_COMPAT_BASE_URL = "https://example.invalid/v1"
$env:A2AMESH_OPENAI_COMPAT_API_KEY = "test-only-placeholder"
$env:A2AMESH_OPENAI_COMPAT_MODEL = "replace-with-model-id"
pnpm --dir examples/openai-compatible-provider run smoke
```

The fake smoke does not validate provider availability. It validates configuration, request shaping, adapter integration, Fleet routing and lifecycle integration, checksummed artifact handoff, capability reporting, and secret-safe failures.

## Configuration

| Variable                                      | Required  | Purpose                                                                                                                                                                                                          |
| --------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `A2AMESH_OPENAI_COMPAT_BASE_URL`              | Yes       | OpenAI-compatible API base URL, normally ending in `/v1`. Embedded credentials, query strings, and fragments are rejected.                                                                                       |
| `A2AMESH_OPENAI_COMPAT_API_KEY`               | Yes       | Provider credential. Keep the real value in your runtime secret manager. For a trusted operator-managed endpoint that requires no authentication, use a non-secret placeholder only if the SDK requires a value. |
| `A2AMESH_OPENAI_COMPAT_MODEL`                 | Yes       | Model identifier sent in the request. There is no source-code default.                                                                                                                                           |
| `A2AMESH_OPENAI_COMPAT_PROFILE`               | No        | Human-readable profile label such as `nvidia-hosted`, `nvidia-operator-managed`, or another compatible provider. Defaults to `custom`.                                                                           |
| `A2AMESH_OPENAI_COMPAT_TIMEOUT_MS`            | No        | Positive request timeout in milliseconds. Defaults to `30000`.                                                                                                                                                   |
| `A2AMESH_OPENAI_COMPAT_MAX_TOKENS`            | No        | Positive `max_tokens` request setting. Omitted when unset.                                                                                                                                                       |
| `A2AMESH_OPENAI_COMPAT_TEMPERATURE`           | No        | Optional temperature between `0` and `2`. Individual models may require a narrower range.                                                                                                                        |
| `A2AMESH_OPENAI_COMPAT_SUPPORTS_STREAMING`    | No        | Operator-declared provider capability: `true`, `false`, or `unknown`. It does not enable adapter streaming.                                                                                                      |
| `A2AMESH_OPENAI_COMPAT_SUPPORTS_TOOL_CALLING` | No        | Operator-declared provider capability: `true`, `false`, or `unknown`. It does not expose tools through the adapter.                                                                                              |
| `A2AMESH_OPENAI_COMPAT_LIVE`                  | Live only | Must equal `1` before the live client is created.                                                                                                                                                                |

Copy `.env.example` only as a variable-name reference. Do not commit populated environment files.

## NVIDIA hosted profile

NVIDIA's hosted OpenAI-compatible base URL is currently:

```text
https://integrate.api.nvidia.com/v1
```

Configure the model identifier from the current NVIDIA catalog or the endpoint's `/v1/models` response. Do not copy a catalog model into application source.

Run a hosted profile through your runtime secret manager without placing the API key in shell history:

```bash
secret-manager run -- pnpm --dir examples/openai-compatible-provider run live:smoke
```

The injected runtime environment should provide at least:

```text
A2AMESH_OPENAI_COMPAT_LIVE=1
A2AMESH_OPENAI_COMPAT_PROFILE=nvidia-hosted
A2AMESH_OPENAI_COMPAT_BASE_URL=https://integrate.api.nvidia.com/v1
A2AMESH_OPENAI_COMPAT_API_KEY=<managed by your secret manager>
A2AMESH_OPENAI_COMPAT_MODEL=<current catalog model id>
```

Hosted development access, quotas, rate limits, model availability, pricing, and terms can change by account, region, catalog entry, and service policy. This example does not promise permanent free access or production availability.

## NVIDIA operator-managed NIM profile

A locally or privately deployed NIM commonly exposes an OpenAI-compatible base such as:

```text
http://127.0.0.1:8000/v1
```

Use the deployment's actual endpoint and query `GET /v1/models` for the served model identifier. NVIDIA NIM can also derive or expose the model name through its deployment configuration, including `NIM_SERVED_MODEL_NAME` where applicable.

An operator-managed profile still requires deployment decisions outside this example:

- NVIDIA NIM and model license/entitlement review,
- supported GPU and capacity planning,
- TLS and network access controls beyond loopback or a trusted private network,
- authentication policy when the endpoint is shared,
- health/readiness monitoring and bounded retries,
- rate-limit, queue-depth, latency, and resource alerts,
- model upgrade, rollback, and compatibility validation.

## Live verification

The live command sends one non-streaming chat-completion request through the same provider-neutral configuration path:

```bash
pnpm --dir examples/openai-compatible-provider run live:smoke
```

It fails before client creation unless `A2AMESH_OPENAI_COMPAT_LIVE=1` is present. Missing variables are reported by name only. Provider error bodies and credentials are not written to the result.

A successful single request is interoperability evidence, not a production certification. Validate the selected model's request limits, tool behavior, streaming behavior, license, lifecycle, and service-level expectations separately.

## Manual GitHub Actions verification

Maintainers can run the manual `Provider Live Smoke` workflow against credentials
in the protected `dev` environment. The workflow accepts provider and model inputs,
then maps the environment secret into this example without printing or persisting the
credential.

- `NVIDIA_API_KEY` exercises the hosted NVIDIA NIM profile.
- `OPENCODE_ZEN_API_KEY` exercises the OpenCode Zen OpenAI-compatible profile.
- OpenCode Zen runs also load the three repository-owned `.opencode/skills/` entries
  with a default-deny permission policy that permits only the `skill` tool.

The workflow is dispatch-only, non-gating, and intentionally absent from pull request,
push, and scheduled triggers. Model availability and free-tier policy can change, so
select a current model at dispatch time and treat each successful run as dated
interoperability evidence rather than a permanent support promise.

## Current compatibility boundary

NVIDIA NIM documents OpenAI-compatible `/v1/chat/completions`, streaming, model discovery, and—in supported releases/models—tool calling. This example records provider capability declarations, keeps the current `OpenAIAdapter` behavior unchanged, and exercises the Fleet worker as read-only text inference:

- chat completions: exercised,
- streaming: not exposed by the adapter,
- tool calling: not exposed by the adapter,
- Fleet worker lifecycle: exercised with an injected fake client and no network access,
- provider tools and remote side effects: denied by the Fleet worker,
- NVIDIA-specific runtime package: not added.

See NVIDIA's current [NIM LLM API reference](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html) and [quickstart](https://docs.nvidia.com/nim/large-language-models/latest/get-started/quickstart.html) before selecting a production profile.
