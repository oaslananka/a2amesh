# JSON Schemas

A2A Mesh publishes deterministic JSON Schema files for the protocol and registry payloads that downstream tools commonly validate.

Run the generator after changing any source type or Zod schema:

```bash
pnpm run schemas:generate
pnpm run schemas:check
```

The docs site serves the same checked-in schemas from `docs-site/public/schemas/` under `https://oaslananka.github.io/a2amesh/schemas/`.

| Payload             | JSON Schema URL                                                                | Checked-in schema                                                                                  | TypeScript source                                                              | Zod source                                                                 |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Agent Card          | `https://oaslananka.github.io/a2amesh/schemas/agent-card.schema.json`          | [`docs/protocol/schemas/agent-card.schema.json`](schemas/agent-card.schema.json)                   | `AnyAgentCard` in `packages/runtime/src/types/agent-card.ts`                   | `AnyAgentCardSchema` in `packages/runtime/src/schemas/public.ts`           |
| Message             | `https://oaslananka.github.io/a2amesh/schemas/message.schema.json`             | [`docs/protocol/schemas/message.schema.json`](schemas/message.schema.json)                         | `Message` in `packages/runtime/src/types/task.ts`                              | `MessageSchema` in `packages/runtime/src/schemas/public.ts`                |
| Task                | `https://oaslananka.github.io/a2amesh/schemas/task.schema.json`                | [`docs/protocol/schemas/task.schema.json`](schemas/task.schema.json)                               | `Task` in `packages/runtime/src/types/task.ts`                                 | `TaskSchema` in `packages/runtime/src/schemas/public.ts`                   |
| Artifact            | `https://oaslananka.github.io/a2amesh/schemas/artifact.schema.json`            | [`docs/protocol/schemas/artifact.schema.json`](schemas/artifact.schema.json)                       | `ExtensibleArtifact` in `packages/runtime/src/types/task.ts`                   | `ExtensibleArtifactSchema` in `packages/runtime/src/schemas/public.ts`     |
| JSON-RPC            | `https://oaslananka.github.io/a2amesh/schemas/json-rpc.schema.json`            | [`docs/protocol/schemas/json-rpc.schema.json`](schemas/json-rpc.schema.json)                       | `JsonRpcRequest \| JsonRpcResponse` in `packages/runtime/src/types/jsonrpc.ts` | `JsonRpcEnvelopeSchema` in `packages/runtime/src/schemas/public.ts`        |
| Registry agent      | `https://oaslananka.github.io/a2amesh/schemas/registry-agent.schema.json`      | [`docs/protocol/schemas/registry-agent.schema.json`](schemas/registry-agent.schema.json)           | `RegisteredAgent` in `packages/registry/src/storage/IAgentStorage.ts`          | `RegisteredAgentSchema` in `packages/runtime/src/schemas/public.ts`        |
| Registry export     | `https://oaslananka.github.io/a2amesh/schemas/registry-export.schema.json`     | [`docs/protocol/schemas/registry-export.schema.json`](schemas/registry-export.schema.json)         | `RegistryExportDocument` in `packages/runtime/src/schemas/public.ts`           | `RegistryExportDocumentSchema` in `packages/runtime/src/schemas/public.ts` |
| Registry task event | `https://oaslananka.github.io/a2amesh/schemas/registry-task-event.schema.json` | [`docs/protocol/schemas/registry-task-event.schema.json`](schemas/registry-task-event.schema.json) | `RegistryTaskEvent` in `packages/registry/src/server/types.ts`                 | `RegistryTaskEventSchema` in `packages/runtime/src/schemas/public.ts`      |

The npm package also exports the Zod symbols from `@a2amesh/runtime/schemas` for callers that prefer runtime parsing over JSON Schema validation.
