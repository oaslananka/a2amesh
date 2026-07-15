# @a2amesh/internal-adapter-google-adk

Google Agent Development Kit (ADK) HTTP adapter for the Agent2Agent protocol.

`GoogleADKAdapter` wraps deployed Google ADK agents as A2A servers, handling task history and streaming responses.

## Status

This is an internal workspace package. It is private, not published to npm, not part of the first public alpha install surface, and not a stable public API.

## Workspace usage

This package is consumed inside the A2A Mesh monorepo through workspace dependencies. Do not install it directly from npm.

If provider SDK dependencies are needed for local development, install them through the workspace using the root pnpm workflow.

## Usage

```ts
import { GoogleADKAdapter } from '@a2amesh/internal-adapter-google-adk';
import type { AnyAgentCard } from '@a2amesh/runtime';

const adapter = new GoogleADKAdapter(
  card,
  'https://my-adk-agent.example.com',
  process.env.GOOGLE_API_KEY,
);
```

See [Compatibility](../../docs/compatibility.md) for supported ranges.

## Network and streaming policy

ADK requests use the shared outbound policy for redirect revalidation, DNS pinning, total
deadlines, response and SSE limits, and telemetry redaction. POST retries carry the A2A
task id as `Idempotency-Key`.

HTTP `text/event-stream` responses are parsed incrementally under the SSE limits, then
returned as one buffered artifact. The adapter therefore advertises
`supportsStreaming: false`; it does not expose live A2A streaming semantics.
