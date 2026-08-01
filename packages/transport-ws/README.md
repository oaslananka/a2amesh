# @a2amesh/internal-transport-ws

WebSocket transport helpers for A2A Mesh.

The package keeps A2A JSON-RPC method names and task semantics while using a persistent
WebSocket connection. It supports:

- message send and streaming;
- task get, list, cancel, and resubscribe;
- push notification configuration create, get, list, and delete;
- Agent Card, authenticated extended card, and health requests;
- A2A protocol-version negotiation;
- an optional connection authentication callback and client handshake headers.

Unary calls use normal JSON-RPC responses. Streaming calls use the same request ID with
`next`, `complete`, and `error` stream frames. Pending requests and stream listeners are
removed on completion, timeout, connection close, and error.

The server does not define application authorization policy. Applications should use the
connection authentication hook and route accepted requests through their normal runtime
authorization boundary.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol,
transport, package, and peer ranges.
