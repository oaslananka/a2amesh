# A2A v1 Compatibility Matrix

Last reviewed: 2026-07-02.

This matrix records the repository-backed compatibility status for the Agent2Agent v1 line. A2A Mesh targets the official v1.0 method surface and keeps selected legacy aliases only where they are already covered by tests.

## Method surface

| A2A operation                         | Runtime                                   | Client SDK                     | CLI                   | REST binding                                                | SSE            | WebSocket          | gRPC               | Verification                                   | Status       |
| ------------------------------------- | ----------------------------------------- | ------------------------------ | --------------------- | ----------------------------------------------------------- | -------------- | ------------------ | ------------------ | ---------------------------------------------- | ------------ |
| `message/send`                        | `handleRpcRequest`                        | `sendMessage`                  | `a2amesh send`        | `POST /message:send`                                        | Not required   | Contract transport | Contract transport | Unit, integration, conformance, examples       | Supported    |
| `message/stream`                      | SSE handler                               | `sendMessageStream`            | Conformance command   | `POST /message:stream`                                      | Canonical path | N/A                | N/A                | Unit, integration, conformance stream fixtures | Supported    |
| `tasks/get`                           | Task lookup with authz                    | `getTask`                      | `a2amesh task status` | `GET /tasks/{taskId}`                                       | N/A            | Contract transport | Contract transport | Unit, integration, transport contract          | Supported    |
| `tasks/list`                          | Task listing with tenant/context filters  | `listTasks`                    | Registry/task flows   | `GET /tasks`                                                | N/A            | Contract transport | Planned            | Unit and performance smoke                     | Supported    |
| `tasks/cancel`                        | Lifecycle transition guard                | `cancelTask`                   | Task command path     | `POST /tasks/{taskId}:cancel`                               | N/A            | Contract transport | Planned            | Unit, integration, transport contract          | Supported    |
| `tasks/resubscribe`                   | Streaming reattach                        | `subscribeTask`                | Conformance command   | `GET /tasks/{taskId}:subscribe`                             | Canonical path | Planned            | Planned            | Unit and conformance stream fixtures           | Supported    |
| `tasks/pushNotificationConfig/create` | Callback config normalization and storage | `createPushNotificationConfig` | N/A                   | `POST /tasks/{taskId}/pushNotificationConfigs`              | N/A            | Planned            | Planned            | Unit and push notification integration tests   | Supported    |
| `tasks/pushNotificationConfig/get`    | Config lookup                             | `getPushNotificationConfig`    | N/A                   | `GET /tasks/{taskId}/pushNotificationConfigs/{configId}`    | N/A            | Planned            | Planned            | Unit tests                                     | Supported    |
| `tasks/pushNotificationConfig/list`   | Config list result                        | `listPushNotificationConfigs`  | N/A                   | `GET /tasks/{taskId}/pushNotificationConfigs`               | N/A            | Planned            | Planned            | Unit tests                                     | Supported    |
| `tasks/pushNotificationConfig/delete` | Config removal                            | `deletePushNotificationConfig` | N/A                   | `DELETE /tasks/{taskId}/pushNotificationConfigs/{configId}` | N/A            | Planned            | Planned            | Unit tests                                     | Supported    |
| `agent/getAuthenticatedExtendedCard`  | Authenticated extended card lookup        | `getAuthenticatedExtendedCard` | N/A                   | JSON-RPC only                                               | N/A            | Planned            | Planned            | Unit and integration tests                     | Supported    |
| `agent/authenticatedExtendedCard`     | Legacy alias retained                     | `authenticatedExtendedCard`    | N/A                   | JSON-RPC only                                               | N/A            | Planned            | Planned            | Unit and integration tests                     | Legacy alias |

## Protocol negotiation and metadata

| Capability                             | Implementation                                                                            | Verification                             | Status    |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- | --------- |
| `A2A-Version` header negotiation       | Runtime HTTP middleware, client headers, WebSocket query negotiation, gRPC metadata paths | Unit, transport, and compatibility tests | Supported |
| `application/a2a+json` REST media type | REST binding responses and protocol-version errors                                        | Unit tests                               | Supported |
| Required extension rejection           | Runtime message configuration validation                                                  | Unit and integration tests               | Supported |
| Optional extension passthrough         | Task/message extension propagation                                                        | Unit tests and golden traces             | Supported |
| Agent Card signing                     | Runtime/registry signing and verification helpers                                         | Unit tests and registry hardening tests  | Supported |
| JSON-RPC error normalization           | Runtime JSON-RPC handler and REST problem detail mapping                                  | Unit, fuzz, and integration tests        | Supported |
| Tenant-aware task authorization        | Runtime and registry request context filters                                              | Unit and integration tests               | Supported |

The conformance fixtures additionally execute the exact public Agent Card discovery
path, validate interface and extension metadata, reject unsupported required
extensions and protocol versions, and compare JSON-RPC/REST task and push
configuration results. SSE version rejection runs in the same suite. WebSocket and
gRPC parity is limited to the operations each transport declares and is exercised by
their package tests and the shared transport contract; HTTP-only routes remain
explicitly `Planned` for those transports.

## Compatibility policy

- Official v1.0 methods must be covered by at least one runtime test and one integration or conformance test before they are marked supported.
- Legacy aliases may remain only when they are documented and covered by tests.
- Experimental v1.2 features must require explicit opt-in and must not replace the v1.0 default path.
- New transports must share the same task lifecycle, error, version-negotiation, and authorization semantics as HTTP JSON-RPC.
