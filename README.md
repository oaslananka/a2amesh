<div align="center">

<h1>A2A Mesh</h1>

<p><strong>Production-grade TypeScript runtime and toolkit for Agent2Agent (A2A): agent cards, JSON-RPC tasks, registry discovery, transports, adapters, MCP bridge, and conformance fixtures.</strong></p>

<p>
  <a href="https://www.npmjs.com/package/@a2amesh/runtime"><img src="https://img.shields.io/npm/v/%40a2amesh%2Fruntime/latest?style=flat-square&logo=npm&label=npm&color=cb3837" alt="npm latest version" /></a>
  <a href="https://www.npmjs.com/package/@a2amesh/runtime?activeTab=versions"><img src="https://img.shields.io/npm/v/%40a2amesh%2Fruntime/alpha?style=flat-square&logo=npm&label=alpha&color=cb3837" alt="npm alpha version" /></a>
  <a href="https://www.npmjs.com/package/@a2amesh/runtime"><img src="https://img.shields.io/npm/dt/%40a2amesh%2Fruntime?style=flat-square&logo=npm&label=total%20downloads&color=4c1" alt="npm total downloads" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D24.16%20%3C27-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >=24.16 <27" /></a>
  <a href="https://pnpm.io/"><img src="https://img.shields.io/badge/pnpm-11.7.0-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 11.7.0" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/%40a2amesh%2Fruntime?style=flat-square&label=license&color=blue" alt="license" /></a>
</p>

<p>
  <a href="https://github.com/oaslananka/a2amesh/actions/workflows/ci.yml"><img src="https://github.com/oaslananka/a2amesh/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/oaslananka/a2amesh/actions/workflows/docs.yml"><img src="https://github.com/oaslananka/a2amesh/actions/workflows/docs.yml/badge.svg" alt="Docs" /></a>
  <a href="https://github.com/oaslananka/a2amesh/actions/workflows/security.yml"><img src="https://github.com/oaslananka/a2amesh/actions/workflows/security.yml/badge.svg" alt="Security" /></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/oaslananka/a2amesh"><img src="https://api.securityscorecards.dev/projects/github.com/oaslananka/a2amesh/badge" alt="OpenSSF Scorecard" /></a>
  <a href="docs/openssf-silver-readiness.md"><img src="https://img.shields.io/badge/OpenSSF%20readiness-silver-c0c0c0?style=flat-square" alt="OpenSSF silver readiness" /></a>
</p>

<p>
  <a href="https://deepwiki.com/oaslananka/a2amesh">Ask DeepWiki</a> ·
  <a href="docs/roadmap/open-issues-triage-2026-06-27.md">Roadmap</a> ·
  <a href="docs/repo-maturity-report.md">Maturity report</a> ·
  <a href="docs/openssf-evidence.md">OpenSSF evidence</a> ·
  <a href="docs/security/trust-evidence.md">Security assurance case</a>
</p>

<p>
  <a href="https://www.buymeacoffee.com/oaslananka"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=oaslananka&button_colour=FFDD00&font_colour=000000&font_family=Arial&outline_colour=000000&coffee_colour=ffffff"  height="28" alt="Buy me a coffee" /></a>
  <a href="https://github.com/oaslananka/a2amesh/stargazers"><img src="https://img.shields.io/github/stars/oaslananka/a2amesh?style=for-the-badge&logo=github&label=Star%20on%20GitHub&labelColor=1a1a1a&color=f79000" alt="Star on GitHub" /></a>
</p>

</div>

A2A Mesh is an independent TypeScript runtime and toolkit for the Agent2Agent (A2A) protocol. It is not an official Google, Linux Foundation, or a2aproject package.

## Trust and Supply Chain

A2A Mesh keeps public trust evidence in [`docs/security/trust-evidence.md`](docs/security/trust-evidence.md) and release package verification evidence in [`docs/release/package-verification.md`](docs/release/package-verification.md). The README badges link to workflow-backed signals only: CI, docs, security, OpenSSF Scorecard, OpenSSF readiness, npm package metadata, license, and package-manager constraints.

## What It Provides

- A2A server runtime and client SDK for Agent Cards, JSON-RPC messages, tasks, artifacts, and status transitions.
- Registry components for local discovery and health polling.
- Adapters for OpenAI, Anthropic, LangChain, Google ADK, LlamaIndex, and CrewAI HTTP bridge flows when the optional peer dependency is installed.
- CLI commands for validation, discovery, sending messages, registry export/import, monitoring tasks, benchmarking, diagnostics, and scaffolding.
- MCP bridge, WebSocket transport, gRPC transport, and testing helper packages for repository-verified workflows.
- Runnable examples for authenticated servers, streaming, push notifications, registry tenancy, WebSocket, gRPC, MCP bridge, adapter templates, and a multi-agent registry discovery mesh.

## Install

```bash
pnpm add @a2amesh/runtime
```

PowerShell:

```powershell
pnpm add @a2amesh/runtime
```

## Quickstart

```bash
pnpm dlx @a2amesh/create-a2amesh demo
cd demo
pnpm install
pnpm run dev
```

PowerShell:

```powershell
pnpm dlx @a2amesh/create-a2amesh demo
Set-Location demo
pnpm install
pnpm run dev
```

## CLI Examples

```bash
a2amesh validate ./agent-card.json
a2amesh discover http://127.0.0.1:3000
a2amesh init demo-agent --adapter custom
a2amesh send http://127.0.0.1:3000 "hello"
a2amesh task status http://127.0.0.1:3000 task-123
a2amesh health http://127.0.0.1:3000 --timeout-ms 1000 --json
a2amesh conformance http://127.0.0.1:3000 --protocol-version 1.0 --json
a2amesh conformance-badge report.json --output badge.svg
a2amesh registry export --url http://127.0.0.1:3099 --output ./registry-export.json
a2amesh registry import --url http://127.0.0.1:3099 --input ./registry-export.json
a2amesh export-card http://127.0.0.1:3000 --output ./agent-card.json
a2amesh monitor http://127.0.0.1:3000 --cycles 3
a2amesh benchmark http://127.0.0.1:3000 --requests 25 --concurrency 5
a2amesh release-check
a2amesh doctor --json
```

PowerShell:

```powershell
a2amesh validate .\agent-card.json
a2amesh discover http://127.0.0.1:3000
a2amesh init demo-agent --adapter custom
a2amesh send http://127.0.0.1:3000 "hello"
a2amesh task status http://127.0.0.1:3000 task-123
a2amesh health http://127.0.0.1:3000 --timeout-ms 1000 --json
a2amesh conformance http://127.0.0.1:3000 --protocol-version 1.0 --json
a2amesh conformance-badge report.json --output badge.svg
a2amesh registry export --url http://127.0.0.1:3099 --output .\registry-export.json
a2amesh registry import --url http://127.0.0.1:3099 --input .\registry-export.json
a2amesh export-card http://127.0.0.1:3000 --output .\agent-card.json
a2amesh monitor http://127.0.0.1:3000 --cycles 3
a2amesh benchmark http://127.0.0.1:3000 --requests 25 --concurrency 5
a2amesh release-check
a2amesh doctor --json
```

## Package List

| Package                   | Purpose                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `@a2amesh/protocol`       | Protocol types, Agent Card, Task, Message, Artifact, JSON schemas, compatibility fixtures.        |
| `@a2amesh/runtime`        | A2A client/server runtime, task lifecycle, streaming, push, auth hooks, storage, telemetry hooks. |
| `@a2amesh/registry`       | Agent discovery, health, trust score, signed cards, registry API.                                 |
| `@a2amesh/mcp`            | Secure, auditable, approval-aware, policy-bound A2A ↔ MCP bridge.                                 |
| `@a2amesh/cli`            | CLI binary `a2amesh`.                                                                             |
| `@a2amesh/create-a2amesh` | Project scaffolder.                                                                               |

## A2A Protocol Compatibility

The implementation targets Agent2Agent protocol `v1.0.0`. See [Compatibility](docs/compatibility.md) for the supported Node.js, package, protocol, transport, optional peer, and deprecation policy matrix.

## Security Defaults

- Public HTTP server mode must use authentication unless it is bound to loopback.
- A2A server and registry HTTP routes apply a per-client request limit by default.
- Remote fetches and callback URLs pass SSRF policy helpers.
- CORS and WebSocket origin checks fail closed when configured.
- CLI and bridge code avoid printing full auth headers or concrete secret values.
- Release publishing is owner-triggered only and uses npm Trusted Publishing/OIDC.

## Supported Adapters And Transports

| Surface             | Status                  | Verification                                       |
| ------------------- | ----------------------- | -------------------------------------------------- |
| OpenAI adapter      | Supported               | Unit tests with fake provider objects.             |
| Anthropic adapter   | Supported               | Unit tests with fake provider objects.             |
| LangChain adapter   | Supported               | Unit tests with fake runnables.                    |
| Google ADK adapter  | Supported               | Unit and streaming tests.                          |
| LlamaIndex adapter  | Supported               | Unit tests with fake provider objects.             |
| CrewAI HTTP bridge  | Supported               | Unit tests with local fetch mocks.                 |
| SSE streaming       | Supported               | Unit and integration tests.                        |
| WebSocket transport | Supported               | Package tests.                                     |
| gRPC transport      | Kept as package surface | Build and package checks; see compatibility notes. |
| MCP bridge          | Supported               | Mapping tests.                                     |

## Documentation

- [Install](docs/install.md)
- [Compatibility](docs/compatibility.md)
- [Release process](docs/release/process.md)

Docs site: [https://oaslananka.github.io/a2amesh/](https://oaslananka.github.io/a2amesh/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, and pull request guidance.
Run `pnpm run verify` before submitting changes.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Repository maturity and governance

This repository is maintained as a professional open-source project. See the maturity and contribution documents for the current operating model:

- [Repository maturity report](docs/repo-maturity-report.md)
- [Contributing guide](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Maintainers](MAINTAINERS.md)
- [Roadmap](ROADMAP.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)
- [OpenSSF evidence](docs/openssf-evidence.md)
