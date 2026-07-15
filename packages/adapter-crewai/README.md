# @a2amesh/internal-adapter-crewai

CrewAI HTTP bridge adapter for the Agent2Agent protocol.

`CrewAIAdapter` bridges CrewAI-oriented orchestration to the A2A task contract for transport, discovery, and monitoring.

## Status

This is an internal workspace package. It is private, not published to npm, not part of the first public alpha install surface, and not a stable public API.

## Workspace usage

This package is consumed inside the A2A Mesh monorepo through workspace dependencies. Do not install it directly from npm.

If provider SDK dependencies are needed for local development, install them through the workspace using the root pnpm workflow.

## Usage

```ts
import { CrewAIAdapter } from '@a2amesh/internal-adapter-crewai';
import type { AnyAgentCard } from '@a2amesh/runtime';

const adapter = new CrewAIAdapter(card, 'http://localhost:8080/crewai-bridge');
```

See [Compatibility](../../docs/compatibility.md) for supported ranges.

## Network policy

Bridge requests use the shared outbound policy for redirect revalidation, DNS pinning,
total deadlines, response limits, and telemetry redaction. POST retries carry the A2A task
id as `Idempotency-Key`. Local bridge URLs require
`outboundPolicy: { allowLocalhost: true }`.
