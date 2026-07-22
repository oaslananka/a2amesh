# @a2amesh/runtime

Core runtime, client APIs, auth, telemetry, storage, and middleware for A2A Mesh.

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

`TaskManager` keeps the synchronous `ITaskStorage` API. `AsyncTaskManager` uses `AsyncTaskStorage` for promise-based stores and transactional task updates.

`AsyncTaskStorage.transaction(callback)` is optional but recommended for read/modify/write operations. Implementations should serialize the callback, commit on resolve, and roll back on throw or rejection. Keep external network or timer waits outside the transaction callback.

Use `SyncTaskStorageAdapter` to run an existing `ITaskStorage` implementation behind `AsyncTaskManager`.

SQLite storage is optional. Install `better-sqlite3` in the application workspace before constructing `SqliteTaskStorage` or `AsyncSqliteTaskStorage`.

## Outbound HTTP policy

`A2AClient` and `AgentRegistryClient` use the shared outbound policy by default. An
explicit loopback URL enables loopback access for local development; private networks and
public-to-loopback redirects remain blocked unless narrowly allowed. A hostname allowlist is
restrictive and never bypasses private-address validation. Fetch operations also reject
unresolved names because they cannot bind the connection to a validated address.
A custom `fetchImplementation` is an explicit trusted integration and test escape hatch; it
must honor the supplied `AbortSignal` and Undici dispatcher.

Use `validateAndFetch` or `createOutboundPolicyFetch` for additional outbound surfaces.
Every redirect hop is revalidated and connected through the exact DNS address set that was
validated. HTTPS-to-HTTP redirects are blocked by default. The total deadline covers DNS,
connect, headers, retries, and complete body or SSE consumption. OIDC discovery and JWKS
retrieval use this same path.

Default response limits are 10 MiB total, 10,000 SSE events, 64 KiB per SSE line, 1 MiB
per SSE event buffer, and a 30-second SSE idle interval. Override these through
`OutboundPolicyOptions` when the protocol contract requires a smaller bound. Callers that
inspect only status or headers must cancel the response body.

Retries are enabled only for idempotent methods, replayable request bodies, or requests
carrying an `Idempotency-Key`. URLs and sensitive headers are redacted from logs and spans.
See [SSRF Policy](../../docs/security/ssrf.md).

## Idempotency reservations

`A2AServer` reserves supported `Idempotency-Key` requests before method dispatch. The default
`InMemoryIdempotencyStore` coordinates one Node.js process. Multi-replica deployments must inject a
shared `RedisIdempotencyStore`; its atomic owner-token transitions prevent concurrent replicas from
executing the same scoped request twice. Configure `idempotencyLeaseMs` for the renewable owner
lease and `idempotencyTtlMs` for terminal response replay. See
[Idempotency Reservations](../../docs/operations/idempotency.md).
