# Compatibility

This page is the canonical compatibility matrix for A2A Mesh runtime versions,
package surfaces, protocol fixtures, transports, optional peers, and deprecation
windows.

Last checked on 2026-05-26 against the
[Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json),
the [Node.js release index](https://nodejs.org/download/release/index.json), and
the repository
[`tools/runtime-versions.json`](https://github.com/oaslananka/a2amesh/blob/main/tools/runtime-versions.json)
manifest.

## Runtime Compatibility

The workspace engine range is Node.js `>=22.22.1 <25` and pnpm `>=11 <12`.
In plain engine terms, use Node.js `>=22.22.1 <25` and pnpm >=11 <12.
Development tooling pins pnpm `11.8.0` through `packageManager` and
`tools/runtime-versions.json`.

| Runtime            | Repository status         | Current repository version                | Upstream status on 2026-05-26                                 | Support policy                                                                 |
| ------------------ | ------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Node.js 22 Jod     | Supported LTS floor       | `22.22.3` in CI smoke                     | Maintenance LTS, EOL `2027-04-30`                             | Supported until the repository announces a higher floor through this page.     |
| Node.js 24 Krypton | Preferred LTS line        | `24.16.0` in `.node-version` and `.nvmrc` | Active LTS, maintenance starts `2026-10-20`, EOL `2028-04-30` | Preferred local, CI, docs, and scaffold runtime.                               |
| Node 25            | Not supported             | Not used                                  | Current/maintenance line ending `2026-06-01`                  | Odd-numbered Current lines are not supported until the engine range is raised. |
| pnpm 11            | Supported package manager | `11.8.0`                                  | Latest registry metadata checked separately                   | Required for workspace scripts and lockfile consistency.                       |

Do not rely on Node.js 20 or older. Node.js 20 is outside the repository engine
range and is already EOL in the Node.js project schedule checked for this policy.

## Package Version Matrix

All public packages in the `0.13.0-alpha.1` release line share the same Node engine range: `>=22.22.1 <25`.

| Package                   | Current version | Node range      | Compatibility notes                                                         |
| ------------------------- | --------------- | --------------- | --------------------------------------------------------------------------- |
| `@a2amesh/cli`            | `0.13.0-alpha.1` | `>=22.22.1 <25` | Published `a2amesh` command-line interface.                                 |
| `@a2amesh/mcp`            | `0.13.0-alpha.1` | `>=22.22.1 <25` | A2A and MCP mapping helpers and bridge runtime.                             |
| `@a2amesh/protocol`       | `0.13.0-alpha.1` | `>=22.22.1 <25` | Protocol types, interfaces, constants, and validators.                      |
| `@a2amesh/registry`       | `0.13.0-alpha.1` | `>=22.22.1 <25` | Registry server, discovery, health, and storage helpers.                    |
| `@a2amesh/runtime`        | `0.13.0-alpha.1` | `>=22.22.1 <25` | Core runtime, client/server APIs, task lifecycle, and telemetry/auth hooks. |
| `@a2amesh/create-a2amesh` | `0.13.0-alpha.1` | `>=22.22.1 <25` | Project scaffolder.                                                         |

Patch releases may add compatible bug fixes, tests, and docs. New public package
surfaces must update `public-surface.json`, package docs, and this matrix before
release.

## Protocol Version Matrix

| Protocol version | Status in A2A Mesh                             | Evidence and behavior                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.3`            | Legacy input compatibility only                | Agent Cards and registry interface metadata may be normalized when tests cover the shape. New runtime responses do not target `0.3`.                                                                            |
| `1.0`            | Primary runtime target                         | Core server/client tests, integration tests, Agent Card compatibility, and default CLI conformance use A2A `1.0` as the canonical runtime surface.                                                              |
| `1.2`            | a2amesh experimental profile fixtures (opt-in) | Versioned fixtures and schemas cover the experimental Agent Card, message, task, stream, push, and negative cases. Client negotiation and CLI conformance do not prefer this profile unless the caller opts in. |
| Future versions  | Unsupported until added deliberately           | A new version requires schemas, fixtures, CLI conformance support, docs, and protocol compatibility tests before it is documented as supported.                                                                 |

The executable fixture set lives under `tests/conformance/fixtures/` and is run
with `pnpm run test:conformance`.

## A2A Compatibility Fixture Coverage

The runtime compatibility fixtures explicitly cover these protocol-sensitive paths:

- Omitted `A2A-Version` headers are treated as legacy `0.3` compatibility inputs.
- Explicit `A2A-Version: 1.0` requests are accepted on HTTP+JSON REST surfaces.
- Unsupported requested versions return structured version-negotiation errors instead of falling through to task execution.
- Authenticated extended Agent Card retrieval is covered through the JSON-RPC HTTP binding: public Agent Card discovery remains available, unauthenticated extended-card access fails closed, and authenticated access returns the card.
- Agent Card signing tests cover successful verification, tampering rejection, and untrusted-key rejection.

These fixtures intentionally keep `1.2` as opt-in experimental coverage and do not make it the default client or conformance target.

## Transport Feature Matrix

| Transport surface | Status                       | Covered behavior                                                                                                                               | Required verification                                               |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| HTTP+JSON         | Supported                    | Exact `/.well-known/agent-card.json` discovery, JSON-RPC and REST task semantics, version/extension negotiation, and push notification parity. | Fixture-backed conformance plus core and integration tests.         |
| SSE               | Supported                    | `message/stream`, task event streaming, heartbeat/close behavior, and task resubscribe surfaces.                                               | Core SSE tests, integration tests, and conformance stream fixtures. |
| WebSocket         | Supported package surface    | Request/response A2A JSON-RPC over `@a2amesh/internal-transport-ws`.                                                                           | WebSocket package tests and shared transport contract tests.        |
| gRPC              | Retained package surface     | A2A task and agent-card flows through `@a2amesh/internal-transport-grpc`.                                                                      | gRPC package tests and shared transport contract tests.             |
| MCP bridge        | Bridge, not an A2A transport | Maps supported MCP tool shapes to A2A tool/task concepts.                                                                                      | MCP bridge mapping tests.                                           |

The fixture-backed conformance suite directly compares JSON-RPC and REST task and
push-configuration results and verifies SSE version rejection. WebSocket and gRPC
do not expose every HTTP-only route; their equivalent task, Agent Card, stream,
version-negotiation, malformed-request, and cancellation semantics are executable
through each transport package test and the shared transport contract. `Planned`
cells above are intentionally unsupported and must not be inferred as parity.

No transport should be documented for broad deployment without matching tests and
security documentation for its auth, origin, TLS, or callback behavior.

## Adapter Optional Peer Ranges

Provider and framework SDKs stay peer dependencies where possible so default installs do not pull every integration stack.

| Package            | Peer dependency                             | Supported range          |
| ------------------ | ------------------------------------------- | ------------------------ |
| `@a2amesh/runtime` | `@opentelemetry/exporter-metrics-otlp-http` | `^0.218.0 \|\| ^0.219.0` |
| `@a2amesh/runtime` | `@opentelemetry/exporter-trace-otlp-http`   | `^0.218.0 \|\| ^0.219.0` |
| `@a2amesh/runtime` | `@opentelemetry/resources`                  | `^2.7.1`                 |
| `@a2amesh/runtime` | `@opentelemetry/sdk-metrics`                | `^2.7.1`                 |
| `@a2amesh/runtime` | `@opentelemetry/sdk-node`                   | `^0.218.0 \|\| ^0.219.0` |

Adapter tests use fake provider objects by default. Live provider behavior must
remain opt-in and cannot be required by the default local verification gate.

## Deprecation Policy

A supported runtime, protocol fixture, transport, package entry point, CLI command,
or peer dependency range needs a minimum 90 days notice and one minor release with
documentation before removal. The notice must name the replacement path, migration
steps, affected package versions, and the first release where removal can happen.

Breaking removals should happen in a major release unless the upstream runtime or
provider has already reached EOL or has an active security issue that makes support
unsafe.

### Removal conditions

Removal can proceed only when all of the following are true:

- The deprecation notice has shipped in release notes, this page, and affected
  package docs.
- A compatible replacement or explicit unsupported status is documented.
- Tests, schemas, examples, and command docs no longer depend on the deprecated
  surface.
- Protected branch CI passes on the removal change.
- Security or ecosystem risk from keeping the surface is documented when removal
  happens before the normal notice window.

## Validation Commands

```bash
pnpm run docs:check
pnpm run docs:build
pnpm run lint:md
```

PowerShell:

```powershell
pnpm run docs:check
pnpm run docs:build
pnpm run lint:md
```
