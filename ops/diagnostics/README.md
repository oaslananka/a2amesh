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

Do not include raw task inputs, Authorization headers, cookies, API keys, private webhook tokens, or unredacted application logs.

Use `ops/diagnostics/bundle-manifest.json` as the manifest for support tooling and release evidence.
