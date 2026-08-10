# A2A compatibility fixtures

These fixtures are deterministic, offline evidence for issue #105. They separate the supported
compatibility surfaces instead of treating every A2A version as the same contract.

| File                               | Classification                                    | Owner            | Verified behavior                                                                         |
| ---------------------------------- | ------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `version-negotiation.json`         | Official v1.0, legacy `0.3`, experimental v1.2    | Protocol/runtime | Missing, supported, query, unsupported, and conflicting version metadata                  |
| `authenticated-extended-card.json` | Official method, Mesh compatibility, legacy alias | Runtime/security | Authentication failure and successful extended-card retrieval                             |
| `signed-agent-card.json`           | Official v1.0                                     | Security/interop | Canonicalization, digest, key rotation, malformed signatures, unknown keys, and tampering |

The signed-card fixture contains public keys only. Never commit a private key. To rotate it, generate
new ephemeral signing keys, sign the fixed card payload, retain the public verification keys and JWS
values, and discard the private keys before staging files. A security reviewer must review trust
failure cases; a protocol reviewer must review canonical payload or profile changes.

`tests/conformance/a2a-compatibility-fixtures.test.ts` is the fixture consumer. HTTP/SSE, WebSocket,
and gRPC version rejection is enforced through the shared transport contract. The official v1.0
profile is the only default; legacy behavior is classified explicitly and v1.2 remains opt-in.
