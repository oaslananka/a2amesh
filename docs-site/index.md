# A2A Mesh

Independent TypeScript runtime and toolkit for the Agent2Agent protocol.

## Why A2A Mesh?

A2A Mesh combines runtime, client, registry, adapters, MCP bridge, transports,
CLI diagnostics, schemas, and conformance output in one TypeScript workspace.
It is designed for teams that need a fast local A2A loop and operational
readiness checks.

![A2A Mesh architecture](/diagrams/a2amesh-architecture.svg)

## Start here

1. [Install](guide/installation.md) the core package and CLI.
2. Follow the [Quick Start](guide/quick-start.md) for the shortest code path.
3. Run the [5-minute demo](guide/demo.md) to validate an Agent Card and send a
   task.
4. Review the [production checklist](guide/production-checklist.md) before a
   shared deployment.

![5-minute demo flow](/screenshots/quick-demo-flow.svg)

## What it includes

| Surface             | Use it for                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Runtime and client  | Agent Cards, JSON-RPC messages, tasks, artifacts, and task status transitions.           |
| Registry            | Discovery, health polling, exports, imports, and operator diagnostics.                   |
| CLI                 | Validate, discover, send, monitor, benchmark, conformance, scaffold, and release checks. |
| Adapters and bridge | Provider/framework adapters plus A2A-to-MCP request mapping.                             |
| Transports          | HTTP/SSE baseline plus WebSocket and gRPC package surfaces.                              |
| Schemas and tests   | JSON Schema artifacts, conformance reports, and smoke-testable examples.                 |

## Decision guide

- Use [Official SDKs vs A2A Mesh](guide/sdk-comparison.md) to decide whether
  this toolkit belongs beside or instead of a first-party SDK in your project.
- Use [Architecture](guide/architecture.md) when package boundaries or runtime
  responsibilities change.
- Use [Security](security/authentication.md), [Threat Model](security/threat-model.md),
  and [Production Checklist](guide/production-checklist.md) before production traffic.
- Use [Release Process](release/process.md) for package publishing and
  provenance guardrails.

## Documentation map

- [Install](guide/installation.md)
- [Quick Start](guide/quick-start.md)
- [5-minute Demo](guide/demo.md)
- [Examples](guide/examples.md)
- [Agent Plugin](guide/agent-plugin.md)
- [Architecture](guide/architecture.md)
- [Compatibility](guide/compatibility.md)
- [Protocol Compatibility](protocol/compliance.md)
- [Security](security/authentication.md)
- [Threat Model](security/threat-model.md)
- [Production Checklist](guide/production-checklist.md)
- [Official SDKs vs A2A Mesh](guide/sdk-comparison.md)
- [Release Process](release/process.md)
- [Packages](packages/runtime.md)
