# A2A Mesh Diagnostic Bundle

This directory defines the operator-facing diagnostic bundle shape for support and incident review.

A bundle should contain redacted operational evidence only:

- runtime `/health`
- runtime `/metrics`
- registry `/metrics`
- registry `/metrics/summary`
- package and git version metadata
- redacted runtime environment summary
- relevant dashboard or alert screenshots when available

Do not include raw task inputs, Authorization headers, cookies, API keys, private webhook tokens, private keys, absolute source paths, private network endpoints, or unredacted application logs.

Use `ops/diagnostics/bundle-manifest.json` for general support evidence. Recovery drills and recovery incidents use the stricter `ops/recovery/diagnostic-bundle-manifest.json`, which additionally requires the recovery report and Prometheus metrics. The recovery CLI generates an exact-file allowlisted bundle whose index contains only basenames, sizes, and SHA-256 digests.
