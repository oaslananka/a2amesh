# Install

## Requirements

- Node.js `>=22.22.1 <25`
- pnpm `>=11 <12`

## Install the core runtime

pnpm (recommended):

```bash
pnpm add @a2amesh/runtime
```

npm:

```bash
npm install @a2amesh/runtime
```

yarn:

```bash
yarn add @a2amesh/runtime
```

PowerShell:

```powershell
pnpm add @a2amesh/runtime
```

## Install the CLI globally

```bash
pnpm add --global @a2amesh/cli
```

After install, run `a2amesh --help` to list commands.

## Other Public Packages

The following public packages are part of the A2A Mesh ecosystem:

| Package                   | Description                                       | Install Command                                 |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `@a2amesh/protocol`       | Protocol types and validators (zero dependencies) | `npm install @a2amesh/protocol`                 |
| `@a2amesh/registry`       | Registry server for agent capability discovery    | `npm install @a2amesh/registry`                 |
| `@a2amesh/mcp`            | A2A ↔ MCP bridge and mapping helpers              | `npm install @a2amesh/mcp`                      |
| `@a2amesh/create-a2amesh` | Scaffolding tool to bootstrap new projects        | `npm exec @a2amesh/create-a2amesh -- <project>` |

## Internal Packages

> [!NOTE]
> The following packages are internal/private utilities in this release line. They are **not published** for the first alpha, not part of the stable public API surface, and are subject to change:
>
> - `@a2amesh/internal-auth` (Authentication middleware and JWT/JWKS utilities)
> - `@a2amesh/internal-telemetry` (OpenTelemetry and trace propagation)
> - `@a2amesh/internal-adapter-base` (Abstract base adapter contracts)
> - `@a2amesh/internal-adapters` (Deprecated meta-package)
> - `@a2amesh/internal-adapter-openai` (OpenAI Chat API adapter)
> - `@a2amesh/internal-adapter-anthropic` (Anthropic Claude API adapter)
> - `@a2amesh/internal-adapter-langchain` (LangChain / LangGraph adapter)
> - `@a2amesh/internal-adapter-google-adk` (Google ADK adapter)
> - `@a2amesh/internal-adapter-llamaindex` (LlamaIndex adapter)
> - `@a2amesh/internal-adapter-crewai` (CrewAI adapter)
> - `@a2amesh/internal-transport-ws` (WebSocket transport)
> - `@a2amesh/internal-transport-grpc` (gRPC transport)

See [Compatibility](compatibility.md) for the full version matrix.
