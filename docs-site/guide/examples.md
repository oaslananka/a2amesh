# Examples

The repository includes runnable examples for local deployment modes. Each example has a README, package manifest, `.env.example`, source entrypoint, and smoke test.

Run all examples:

```bash
pnpm run examples:smoke
```

PowerShell:

```powershell
pnpm run examples:smoke
```

## Deployment Modes

| Mode                 | Source                                                                                                         | Smoke command                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Authenticated server | [examples/authenticated-server](https://github.com/oaslananka/a2amesh/tree/main/examples/authenticated-server) | `pnpm --dir examples/authenticated-server run smoke` |
| Streaming            | [examples/streaming](https://github.com/oaslananka/a2amesh/tree/main/examples/streaming)                       | `pnpm --dir examples/streaming run smoke`            |
| Push notifications   | [examples/push-notifications](https://github.com/oaslananka/a2amesh/tree/main/examples/push-notifications)     | `pnpm --dir examples/push-notifications run smoke`   |
| Registry tenancy     | [examples/registry-tenancy](https://github.com/oaslananka/a2amesh/tree/main/examples/registry-tenancy)         | `pnpm --dir examples/registry-tenancy run smoke`     |
| WebSocket            | [examples/websocket](https://github.com/oaslananka/a2amesh/tree/main/examples/websocket)                       | `pnpm --dir examples/websocket run smoke`            |
| gRPC                 | [examples/grpc](https://github.com/oaslananka/a2amesh/tree/main/examples/grpc)                                 | `pnpm --dir examples/grpc run smoke`                 |
| MCP bridge           | [examples/mcp-bridge](https://github.com/oaslananka/a2amesh/tree/main/examples/mcp-bridge)                     | `pnpm --dir examples/mcp-bridge run smoke`           |
| Adapter template     | [examples/adapter-template](https://github.com/oaslananka/a2amesh/tree/main/examples/adapter-template)         | `pnpm --dir examples/adapter-template run smoke`     |
| Agent mesh           | [examples/agent-mesh](https://github.com/oaslananka/a2amesh/tree/main/examples/agent-mesh)                     | `pnpm --dir examples/agent-mesh run smoke`           |

The root smoke command validates the required example file layout, builds the workspace, and runs each compiled smoke test with Node's test runner.
