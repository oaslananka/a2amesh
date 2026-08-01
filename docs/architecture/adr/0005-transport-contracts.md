# ADR-0005: Transport Contracts

## Status

Accepted for the 1.0.0 launch baseline. Expanded on 2026-08-01 to cover the
complete A2A v1 operation surface used by the repository.

## Context

HTTP JSON-RPC is the canonical runtime protocol path. A2A Mesh also ships WebSocket and
gRPC transport helpers so applications can use alternate transport envelopes without
changing task semantics.

Transport drift is easy to introduce when each transport has its own request framing,
streaming behavior, card discovery, health behavior, authentication errors, malformed
request handling, task listing, task resubscription, and push notification configuration
lifecycle. The repository therefore uses shared transport contract tests to make supported
behavior explicit and to require a reason for unsupported capabilities.

The official runtime method semantics already live in the public runtime API. Alternate
transports must preserve those semantics instead of inventing transport-specific task or
configuration models.

## Decision

Keep HTTP JSON-RPC as the source of truth for A2A method semantics. WebSocket and gRPC
transports must adapt to the public runtime API and pass the shared transport contract
for every capability they advertise.

The shared contract requires each transport to declare support for:

- `message/send` and `message/stream`;
- `tasks/get`, `tasks/list`, `tasks/cancel`, and `tasks/resubscribe`;
- `tasks/pushNotificationConfig/create`, `get`, `list`, and `delete`;
- Agent Card discovery and authenticated extended card retrieval;
- health, authentication failures, malformed request handling, and version negotiation.

Unsupported operations must include a reason in the capability map instead of silently
disappearing from the contract.

### WebSocket framing

WebSocket keeps JSON-RPC request and unary response envelopes. Streaming methods use the
same request identifier for the lifetime of a stream and add a transport framing field:

```json
{"jsonrpc":"2.0","id":"request-id","stream":"next","result":{}}
{"jsonrpc":"2.0","id":"request-id","stream":"complete"}
```

A stream failure uses the normal JSON-RPC error object with `stream: "error"`. The client
must remove pending stream state on completion, error, timeout, connection close, or
explicit cancellation. Unary methods continue to reject unexpected stream frames.

### gRPC framing

gRPC uses typed RPC names for the A2A operation surface. Canonical runtime values remain
JSON-encoded inside bounded protobuf string fields so task, Agent Card, list result, and
push notification configuration schemas stay owned by the runtime package. Request
messages carry only the operation inputs needed by the public runtime contract, including
context identifiers, task identifiers, configuration identifiers, and JSON configuration
payloads.

Server streaming is used for `message/stream` and `tasks/resubscribe`. Unary RPCs are used
for task listing, cancellation, Agent Card operations, health, and push notification
configuration CRUD. Protocol version negotiation stays in gRPC metadata.

### Package boundaries and failures

Transport implementations must not import private runtime internals across package
boundaries. They should use public core APIs, package-level test helpers, and local
transport-specific framing code.

Transport adapters must preserve fail-closed behavior:

- unsupported protocol versions are rejected before operation execution;
- malformed transport payloads do not reach runtime handlers;
- missing tasks and configurations produce stable transport errors or documented null
  results, matching the public runtime method contract;
- stream listeners and pending requests are always cleaned up;
- internal exception details are not exposed when a stable public error is available.

## Consequences

New transports need a contract spec before they are documented as supported. Existing
transports can intentionally differ in envelope details, but task creation, listing,
terminal state observation, cancellation, resubscription, push configuration lifecycle,
Agent Card behavior, auth failure behavior, and malformed request reporting stay
comparable.

The WebSocket streaming envelope is an A2A Mesh transport convention, not a claim that
JSON-RPC itself defines multi-response calls. The gRPC protobuf surface remains an adapter
over canonical runtime schemas rather than a second source of protocol types.

When a protocol feature is added to the runtime, the transport contract becomes the
coordination point for deciding whether WebSocket and gRPC support it immediately or
declare an explicit unsupported reason.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
pnpm run test
pnpm run verify:structure
```

Relevant coverage:

- [`transportContract.ts`](../../../tests/transport-contract/transportContract.ts)
- [`WebSocket transport contract`](../../../packages/transport-ws/tests/transport-contract.test.ts)
- [`gRPC transport contract`](../../../packages/transport-grpc/tests/transport-contract.test.ts)
- [`client/server integration`](../../../tests/integration/client-server.test.ts)
