# API Surface Drift Gates

A2A Mesh treats generated API surfaces as release-blocking artifacts. Public API changes must update the generated artifacts and pass the unified surface gate.

## Covered surfaces

| Surface            | Source of truth                           | Checked artifact                                                                       |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| JSON Schema        | `packages/runtime/src/schemas/public.ts`  | `docs/protocol/schemas`, `docs-site/public/schemas`, `packages/protocol/schemas`       |
| OpenAPI            | `packages/registry/src/openapi.ts`        | `docs/openapi/registry.openapi.json`, `docs-site/public/openapi/registry.openapi.json` |
| TypeScript exports | package `exports` fields                  | `packages/*/public-surface.json` for public packages                                   |
| Protobuf           | `packages/transport-grpc/proto/a2a.proto` | `packages/transport-grpc/proto/a2a.proto.sha256`                                       |

## Commands

Check all public surfaces:

```bash
pnpm run api:surfaces:check
```

Update generated surfaces after an intentional API change:

```bash
pnpm run api:surfaces:write
```

The write command regenerates JSON Schema and OpenAPI outputs and refreshes the protobuf surface hash. TypeScript public-surface files remain explicit inventory files and should be reviewed manually when package exports change.

## CI behavior

Pull requests run `CI / api-surfaces`. The job fails when:

- generated JSON Schema files are missing, stale, or changed without regeneration;
- Registry OpenAPI output drifts from the generator;
- public package `exports` drift from their `public-surface.json` inventory;
- the protobuf service file changes without updating `a2a.proto.sha256`;
- the protobuf file stops exposing the required A2A service and message entries.

The goal is not to block API evolution. The goal is to make API evolution explicit, reviewable, and reproducible.
