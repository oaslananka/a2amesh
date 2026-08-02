# API Surface Drift Gates

A2A Mesh treats generated API surfaces as release-blocking artifacts. Public API changes must update the generated artifacts and pass the unified surface gate.

## Covered surfaces

| Surface                  | Source of truth                           | Checked artifact                                                                       |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| JSON Schema              | `packages/runtime/src/schemas/public.ts`  | `docs/protocol/schemas`, `docs-site/public/schemas`, `packages/protocol/schemas`       |
| OpenAPI                  | `packages/registry/src/openapi.ts`        | `docs/openapi/registry.openapi.json`, `docs-site/public/openapi/registry.openapi.json` |
| Package exports and bins | package `exports` and `bin` fields        | `packages/*/public-surface.json` for all six published packages                        |
| Protobuf                 | `packages/transport-grpc/proto/a2a.proto` | `packages/transport-grpc/proto/a2a.proto.sha256`                                       |

## Commands

Check all public surfaces:

```bash
pnpm run api:surfaces:check
```

Update generated surfaces after an intentional API change:

```bash
pnpm run api:surfaces:write
```

The write command regenerates JSON Schema and OpenAPI outputs and refreshes the protobuf surface hash. Public-surface files remain explicit inventories and must be reviewed when package exports, executable names, or release-channel status changes. Use `node scripts/check-public-surface.mjs --target=stable` to require stable versions and inventories for every published package.

## CI behavior

Pull requests run `CI / api-surfaces`. The job fails when:

- generated JSON Schema files are missing, stale, or changed without regeneration;
- Registry OpenAPI output drifts from the generator;
- public package `exports`, executable names, or release-channel status drift from their `public-surface.json` inventory;
- the protobuf service file changes without updating `a2a.proto.sha256`;
- the protobuf file stops exposing the required A2A service and message entries.

The goal is not to block API evolution. The goal is to make API evolution explicit, reviewable, and reproducible.
