# Threat Model

Trust boundaries:

- Public HTTP requests entering A2A server handlers.
- Registry registration and discovery APIs.
- Remote Agent Card, callback, and push notification URLs.
- Optional provider SDK calls.
- MCP bridge inputs and outputs.
- CLI arguments and terminal output.

Controls:

- Public HTTP server mode must not run with unauthenticated access unless bound to loopback.
- Runtime and registry HTTP routes install a default per-client rate limiter; deployments can tune the window and maximum request count through `rateLimit`.
- URL policy helpers reject private, link-local, loopback, and unsupported schemes for remote operations unless an explicit development flag is used.
- Auth middleware redacts concrete credential material in errors and logs.
- Idempotency replay records compare a deterministic HMAC-SHA-256 fingerprint over stable request JSON that already includes the caller scope, method, and params. The HMAC domain is `a2amesh:idempotency:fingerprint:v1`, separating replay fingerprints from credential or password hashing, and cache keys encode scope/key components before storage to avoid delimiter collisions. Existing replay cache entries from earlier fingerprint versions may miss after deploy; the replay TTL bounds that transition.
- Registry and task access tests cover principal/tenant behavior where auth context is enabled.
- Authenticated runtime task access is default-deny: cross-tenant, cross-owner, and legacy tasks without complete ownership metadata are not visible or accessible.
- WebSocket transport validates origin/auth before accepting application messages.
- MCP bridge code must not forward secrets to downstream agents or logs.
