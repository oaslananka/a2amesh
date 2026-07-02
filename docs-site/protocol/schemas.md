# JSON Schemas

A2A Mesh publishes deterministic JSON Schema files for the protocol and registry payloads that downstream tools commonly validate.

The generated files are served from `/schemas/` on the docs site and are checked into `docs/protocol/schemas/` for source review.

| Payload             | JSON Schema URL                                                                        | TypeScript source                                                              | Zod source                                                             |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Agent Card          | [`/schemas/agent-card.schema.json`](/schemas/agent-card.schema.json)                   | `AnyAgentCard` in `packages/runtime/src/types/agent-card.ts`                   | `AnyAgentCardSchema` in `packages/runtime/src/schemas/public.ts`       |
| Message             | [`/schemas/message.schema.json`](/schemas/message.schema.json)                         | `Message` in `packages/runtime/src/types/task.ts`                              | `MessageSchema` in `packages/runtime/src/schemas/public.ts`            |
| Task                | [`/schemas/task.schema.json`](/schemas/task.schema.json)                               | `Task` in `packages/runtime/src/types/task.ts`                                 | `TaskSchema` in `packages/runtime/src/schemas/public.ts`               |
| Artifact            | [`/schemas/artifact.schema.json`](/schemas/artifact.schema.json)                       | `ExtensibleArtifact` in `packages/runtime/src/types/task.ts`                   | `ExtensibleArtifactSchema` in `packages/runtime/src/schemas/public.ts` |
| JSON-RPC            | [`/schemas/json-rpc.schema.json`](/schemas/json-rpc.schema.json)                       | `JsonRpcRequest \| JsonRpcResponse` in `packages/runtime/src/types/jsonrpc.ts` | `JsonRpcEnvelopeSchema` in `packages/runtime/src/schemas/public.ts`    |
| Registry agent      | [`/schemas/registry-agent.schema.json`](/schemas/registry-agent.schema.json)           | `RegisteredAgent` in `packages/registry/src/storage/IAgentStorage.ts`          | `RegisteredAgentSchema` in `packages/runtime/src/schemas/public.ts`    |
| Registry task event | [`/schemas/registry-task-event.schema.json`](/schemas/registry-task-event.schema.json) | `RegistryTaskEvent` in `packages/registry/src/server/types.ts`                 | `RegistryTaskEventSchema` in `packages/runtime/src/schemas/public.ts`  |

Update the generated artifacts after changing any listed type or schema:

```bash
pnpm run schemas:generate
pnpm run schemas:check
```

The npm package exports the Zod symbols from `@a2amesh/runtime/schemas` for callers that prefer runtime parsing over JSON Schema validation.
