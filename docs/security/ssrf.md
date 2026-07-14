# SSRF Policy

A2A Mesh routes outbound HTTP through the runtime policy instead of calling raw `fetch`
from clients, adapters, callbacks, registry polling, MCP bridges, or the CLI.

## Default boundary

The default policy accepts HTTP and HTTPS but rejects private, loopback, link-local,
metadata-service, multicast, and otherwise unsafe destinations. A client configured with
an explicit loopback literal such as `localhost`, `127.0.0.1`, or `::1` may use that
loopback destination for local development. A public hostname does not inherit loopback
permission, so a redirect or DNS answer that moves it to loopback remains blocked.

Private-network access and extra schemes require explicit policy exceptions. A non-empty
`allowedHostnames` list is restrictive: every hop must match it, and a matching hostname
still cannot resolve to a private address unless private-network access is separately
allowed. `allowUnresolvedHostnames` is available to validation-only callers; outbound fetches
remain fail-closed because an unresolved name cannot be pinned to a validated connection.
Production exceptions should stay scoped to one operation and one trusted destination.

## Redirect and DNS enforcement

Redirects use manual handling. Every hop is parsed, scheme-checked, DNS-resolved, and
validated again before the next request. Cross-origin redirects remove authorization,
API-key, cookie, and other credential-shaped headers. Redirect count is bounded, and
HTTPS-to-HTTP downgrade redirects are rejected unless explicitly enabled.

For each hop, the validated DNS address set is installed into a request-scoped Undici
lookup function. The connection cannot ask the operating system resolver for a different
address after validation. This closes the validation-to-connect DNS rebinding window.
Cached DNS results, when enabled, are still the exact results used by the connection.

## Deadline and response limits

`timeoutMs` is a total operation deadline. It covers DNS resolution, connection setup,
response headers, redirects, retry backoff, and response-body or SSE consumption. It is
not cleared when headers arrive.

Responses are bounded before callers buffer them:

- total response bytes, including JSON, text, binary, and SSE;
- SSE event count;
- SSE line bytes;
- bytes buffered for one SSE event;
- SSE idle duration.

Callers that inspect only status or headers must consume or cancel the response body. Core
clients, registry polling, callbacks, and adapters do this automatically.

## Retry safety

Retries are method-aware. GET, HEAD, PUT, DELETE, OPTIONS, and TRACE may be retried when
configured. POST and other non-idempotent methods are attempted once unless the caller
provides an `Idempotency-Key` or explicitly enables non-idempotent retry. Streaming request
bodies are never replayed.

Push notifications, CrewAI bridge requests, and Google ADK requests use the task id as an
idempotency key. A2A JSON-RPC calls do not retry automatically unless the caller provides
an idempotency key.

## Logging and telemetry

Authorization and credential-shaped headers are redacted. URLs written to logs or spans
omit user information, fragments, and query-string values. Error text is passed through
the same URL and secret redaction before emission.

## Verification

The adversarial suite covers public-to-private and HTTPS-to-HTTP redirects, restrictive
hostname allowlists, DNS binding, unresolved hosts, slow bodies, oversized bodies,
unbounded SSE, abort propagation, sensitive query values, and idempotent versus
non-idempotent retries. OIDC discovery and JWKS retrieval use the same policy and fixtures.

```bash
pnpm exec vitest run --project unit \
  packages/runtime/tests/OutboundPolicy.test.ts \
  packages/runtime/tests/fetchWithPolicy.test.ts
```
