# Examples

The `examples/` workspace contains runnable examples for the main local deployment modes. Each example includes a README, package manifest, `.env.example`, source entrypoint, and smoke test.

Run all examples:

```bash
pnpm run examples:smoke
```

PowerShell:

```powershell
pnpm run examples:smoke
```

## Deployment Modes

| Mode                 | Path                                                                          | Smoke command                                        |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Authenticated server | [`examples/authenticated-server`](../examples/authenticated-server/README.md) | `pnpm --dir examples/authenticated-server run smoke` |
| Streaming            | [`examples/streaming`](../examples/streaming/README.md)                       | `pnpm --dir examples/streaming run smoke`            |
| Push notifications   | [`examples/push-notifications`](../examples/push-notifications/README.md)     | `pnpm --dir examples/push-notifications run smoke`   |
| Registry tenancy     | [`examples/registry-tenancy`](../examples/registry-tenancy/README.md)         | `pnpm --dir examples/registry-tenancy run smoke`     |
| WebSocket            | [`examples/websocket`](../examples/websocket/README.md)                       | `pnpm --dir examples/websocket run smoke`            |
| gRPC                 | [`examples/grpc`](../examples/grpc/README.md)                                 | `pnpm --dir examples/grpc run smoke`                 |
| MCP bridge           | [`examples/mcp-bridge`](../examples/mcp-bridge/README.md)                     | `pnpm --dir examples/mcp-bridge run smoke`           |
| Adapter template     | [`examples/adapter-template`](../examples/adapter-template/README.md)         | `pnpm --dir examples/adapter-template run smoke`     |
| Agent mesh           | [`examples/agent-mesh`](../examples/agent-mesh/README.md)                     | `pnpm --dir examples/agent-mesh run smoke`           |

The root `examples:smoke` script validates the required file layout, builds the workspace, and runs every compiled smoke test with Node's test runner.
