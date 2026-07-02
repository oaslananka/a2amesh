# Protocol Profiles

A2A Mesh conformance now uses explicit compatibility profiles instead of treating every fixture as the same protocol contract. The profile artifact lives in `packages/runtime/src/testing/profiles.ts` and is included in every conformance JSON report as `profile` plus a row-level `coverage` matrix.

## Profiles

| Profile                 | Strict | Protocol | Purpose                                                                                                                |
| ----------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `official-a2a-v1.0`     | Yes    | `1.0`    | The default strict profile aligned to the normative A2A v1.0 protobuf and HTTP+JSON binding surface.                   |
| `legacy-a2amesh`        | No     | `1.0`    | Backwards-compatible behavior for existing A2A Mesh JSON-RPC paths, local aliases, and push notification method names. |
| `experimental-a2a-v1.2` | No     | `1.2`    | Opt-in fixtures for future A2A Mesh behavior. Requires `--experimental-profiles`.                                      |

## Status vocabulary

| Status         | Meaning                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `supported`    | Implemented and exercised by the current profile fixture surface.                  |
| `partial`      | Implemented in part, but the strict profile records an explicit gap or follow-up.  |
| `legacy-alias` | Supported for A2A Mesh compatibility, but not the canonical official v1.0 surface. |
| `unsupported`  | Not implemented yet; the coverage row must name the issue that tracks it.          |

The official strict profile is now CI-blocking for required A2A v1.0 coverage: every required row must be `supported`, and `partial`, `unsupported`, or `legacy-alias` rows are allowed only outside the official strict profile. This prevents local conformance from silently passing only A2A Mesh-specific behavior.

## Running the strict profile

```bash
a2amesh conformance http://127.0.0.1:3000 --profile official-a2a-v1.0 --strict --json
```

The equivalent programmatic API is:

```ts
const report = await runConformanceSuite({
  client,
  endpointUrl: 'http://127.0.0.1:3000',
  packageVersion: '11.0.0',
  profile: 'official-a2a-v1.0',
  strict: true,
});
```

## Report fields

Strict profile reports include these additional fields:

```json
{
  "profile": {
    "id": "official-a2a-v1.0",
    "strict": true,
    "protocolVersion": "1.0",
    "coverage": {
      "supported": 3,
      "partial": 4,
      "legacyAlias": 1,
      "unsupported": 1,
      "requiredUnsupported": 1
    }
  },
  "coverage": [
    {
      "id": "binding.http-json-rest",
      "status": "supported",
      "required": true,
      "trackedBy": "#316"
    }
  ]
}
```

The `coverage` rows are designed for dashboards such as #300. They can be rendered as a visual compliance report without re-encoding profile rules in the UI.

## Relationship to protocol versions

`--protocol-version 1.0` maps to `official-a2a-v1.0` by default. `--strict` also resolves to `official-a2a-v1.0` when no `--profile` is provided.

`--protocol-version 1.2` maps to `experimental-a2a-v1.2` and requires `--experimental-profiles`. This keeps experimental fixtures opt-in and separate from the official strict profile.

## Legacy profile

Use the legacy profile only when validating compatibility with existing A2A Mesh clients or servers:

```bash
a2amesh conformance http://127.0.0.1:3000 --profile legacy-a2amesh --json
```

Legacy rows are still visible as `legacy-alias` so downstream reports can distinguish backwards compatibility from official protocol support.
