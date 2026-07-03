# Protocol Compatibility

See also: [A2A v1 Compatibility Matrix](./a2a-v1-compatibility-matrix.md).

Spec reference: official Agent2Agent `v1.0.0` release, published 2026-03-12 and checked on 2026-05-27 at <https://github.com/a2aproject/A2A/releases/tag/v1.0.0>. The release tag points at commit `173695755607e884aa9acf8ce4feed90e32727a1`; the checked `docs/specification.md` blob is `7095fc0bad3d5a05edb6cfaf92e67d96bf91290c`. Latest upstream `main` was checked at commit `cd87b9341bc0e4982d46550aaab2319b903271e4`, dated 2026-05-26. No upstream `v1.2` release was present in the checked tags (`v1.0.0`, `v1.0.0-rc`, `v0.3.0`, `v0.2.6`).

Implementation target: official A2A `1.0`, legacy `0.3` Agent Card normalization, and a2amesh experimental `1.2` profile fixtures that require explicit opt-in.

For the broader Node.js, package, transport, optional peer, and deprecation policy matrix, see [Compatibility](../compatibility.md).

## Compatibility Profiles

The executable compatibility contract is now defined in [Protocol Profiles](./profiles.md). The `official-a2a-v1.0` strict profile is the default for `a2amesh conformance`; it reports supported, partial, legacy-alias, and unsupported rows instead of hiding known protocol gaps.

## Official Target

A2A Mesh defaults to official A2A `1.0` for client interface selection, runtime compatibility, and `a2amesh conformance`. This keeps published behavior aligned with the latest official upstream A2A release instead of preferring repository-local experimental fixture profiles.

## Legacy Normalization

Legacy `0.3` Agent Cards and registry interface metadata may be normalized where tests cover the input shape. New runtime responses do not target `0.3`, and compatibility docs must not describe `0.3` as an active output protocol.

## Experimental Profiles

The `1.2` fixture directory is an a2amesh experimental profile. It is useful for forward-looking schema and fixture coverage, but it is not treated as an official upstream A2A protocol release. `A2AClient.connect` and `a2amesh conformance` do not prefer this profile unless the caller opts in with `allowExperimentalProtocolVersions`; CLI conformance `1.2` requires `--experimental-profiles`.

| Feature                                                     | Status                                       | Evidence                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Cards / discovery metadata                            | Implemented                                  | `packages/runtime/tests/agent-card.test.ts`; `tests/conformance/fixtures/a2a-1.0/agent-card.json`; `tests/conformance/fixtures/a2a-1.2/agent-card.json`                                                                                             |
| JSON-RPC request/response envelopes                         | Implemented                                  | `tests/integration/a2a-protocol-compliance.test.ts`; `tests/conformance/fixtures/a2a-1.0/message-request.json`; `tests/conformance/fixtures/a2a-1.2/message-request.json`                                                                           |
| JSON-RPC batch requests                                     | Explicitly rejected with `InvalidRequest`    | `packages/runtime/tests/A2AServerEdge.test.ts`; `tests/conformance/fixtures/a2a-1.0/negative-cases.json`; `tests/conformance/fixtures/a2a-1.2/negative-cases.json`                                                                                  |
| Messages, tasks, artifacts                                  | Implemented                                  | core and integration tests; `tests/conformance/fixtures/a2a-1.0/task-response.json`; `tests/conformance/fixtures/a2a-1.2/task-response.json`                                                                                                        |
| Task status transitions                                     | Implemented                                  | `packages/runtime/tests/TaskManager.test.ts`; `tests/conformance/a2a-conformance.test.ts`                                                                                                                                                           |
| Streaming/SSE                                               | Implemented                                  | `packages/runtime/tests/SSEStreamer.test.ts`; `tests/conformance/fixtures/a2a-1.0/stream-events.json`; `tests/conformance/fixtures/a2a-1.2/stream-events.json`                                                                                      |
| Push notifications                                          | Implemented where configured                 | `tests/integration/push-notification.test.ts`; `tests/conformance/fixtures/a2a-1.0/push-config.json`; `tests/conformance/fixtures/a2a-1.2/push-config.json`                                                                                         |
| Capability discovery                                        | Implemented                                  | registry and client tests; `tests/conformance/fixtures/a2a-1.0/agent-card.json`; `tests/conformance/fixtures/a2a-1.2/agent-card.json`                                                                                                               |
| MCP bridge mapping                                          | Implemented for repository-supported mapping | `packages/mcp/tests/mcp.test.ts`                                                                                                                                                                                                                    |
| Extension negotiation (supported/optional/required-unknown) | Implemented                                  | `tests/conformance/a2a-conformance.test.ts`                                                                                                                                                                                                         |
| Unsupported protocol version handling (JSON-RPC, REST, SSE) | Implemented                                  | `tests/conformance/a2a-conformance.test.ts`                                                                                                                                                                                                         |
| Cross-transport parity (HTTP/SSE, WebSocket, gRPC)          | Implemented                                  | `tests/transport-contract/http-sse.test.ts`; `packages/transport-ws/tests/transport-contract.test.ts`; `packages/transport-grpc/tests/transport-contract.test.ts` share `runTransportContract` from `tests/transport-contract/transportContract.ts` |
| gRPC transport                                              | Implemented                                  | `packages/transport-grpc/tests/transport-contract.test.ts`                                                                                                                                                                                          |

## Executable Conformance Fixtures

Run the versioned fixtures with:

```bash
pnpm run test:conformance
```

Fixture coverage:

| Fixture path                                              | Covered behavior                                               |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `tests/conformance/fixtures/a2a-1.0/agent-card.json`      | A2A `1.0` discovery metadata and capabilities                  |
| `tests/conformance/fixtures/a2a-1.0/message-request.json` | A2A `1.0` `message/send` JSON-RPC request                      |
| `tests/conformance/fixtures/a2a-1.0/task-response.json`   | A2A `1.0` task, message history, and artifact result           |
| `tests/conformance/fixtures/a2a-1.0/stream-events.json`   | A2A `1.0` `message/stream` JSON-RPC SSE flow                   |
| `tests/conformance/fixtures/a2a-1.0/push-config.json`     | A2A `1.0` push notification configuration                      |
| `tests/conformance/fixtures/a2a-1.0/negative-cases.json`  | A2A `1.0` negative JSON-RPC cases                              |
| `tests/conformance/fixtures/a2a-1.2/agent-card.json`      | a2amesh experimental `1.2` discovery metadata and capabilities |
| `tests/conformance/fixtures/a2a-1.2/message-request.json` | a2amesh experimental `1.2` `message/send` JSON-RPC request     |
| `tests/conformance/fixtures/a2a-1.2/task-response.json`   | a2amesh experimental `1.2` task, history, and data artifact    |
| `tests/conformance/fixtures/a2a-1.2/stream-events.json`   | a2amesh experimental `1.2` `message/stream` SSE flow           |
| `tests/conformance/fixtures/a2a-1.2/push-config.json`     | a2amesh experimental `1.2` push notification configuration     |
| `tests/conformance/fixtures/a2a-1.2/negative-cases.json`  | a2amesh experimental `1.2` negative JSON-RPC cases             |
