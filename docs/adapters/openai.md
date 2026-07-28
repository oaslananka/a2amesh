# OpenAI Adapter

The OpenAI adapter is an internal, optional workspace package covered by fake-provider unit tests. It accepts a client and model identifier from the caller; live provider calls are opt-in.

For a provider-neutral OpenAI-compatible configuration path, see the [OpenAI-compatible provider example](../../examples/openai-compatible-provider/README.md). The example uses NVIDIA NIM as one documented hosted/operator-managed deployment profile without adding a NVIDIA-specific adapter, hard-coding a model, or requiring a live credential in CI.

The current adapter exercises non-streaming text chat completions. Provider support for streaming or tool calling must not be interpreted as adapter support until those surfaces are implemented and tested separately.
