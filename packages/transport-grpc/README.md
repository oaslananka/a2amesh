# @a2amesh/internal-transport-grpc

gRPC transport helpers for A2A Mesh.

The package maps the repository's A2A v1 operation contract to typed gRPC RPC names. It
supports:

- message send and server streaming;
- task get, list, cancel, and server-streaming resubscription;
- push notification configuration create, get, list, and delete;
- Agent Card, authenticated extended card, and health requests;
- A2A protocol-version metadata;
- optional metadata authentication and push configuration normalization hooks.

Canonical Agent Card, task, list, health, and push configuration values remain owned by
the runtime package and are JSON-encoded inside bounded protobuf string fields. Existing
protobuf field numbers are retained when the service surface grows.

The server authentication hook protects the transport boundary. Applications remain
responsible for tenant and principal authorization in the runtime or service layer.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol,
transport, package, and peer ranges.
