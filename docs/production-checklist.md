# Production Checklist

Use this checklist before exposing an A2A Mesh runtime, registry, or bridge to a
shared environment.

## Runtime

- Bind unauthenticated demos to loopback only.
- Require authentication for public HTTP routes.
- Configure allowed callback and push notification URLs.
- Enable request limits and fail-closed CORS or WebSocket origin policy.
- Persist tasks in a storage backend that matches retention and recovery needs.

## Registry

- Separate public, private, and tenant-scoped agent visibility.
- Publish Agent Cards with accurate auth schemes, capabilities, and transport
  URLs.
- Monitor health failure reasons and remove stale registrations.
- Export registry state before migrations or operator demos.

## Security

- Verify JWT/JWKS, OAuth/OIDC, or mTLS expectations before production traffic.
- Redact credentials in CLI, server, bridge, and registry logs.
- Keep SSRF policy helpers on outbound fetches and callback validation paths.
- Review dependency updates and release provenance before deploying a new
  package version.

## Observability

- Set service names and trace propagation for runtime, registry, and bridge
  processes.
- Capture task state transitions, message events, artifact creation, and errors.
- Keep conformance reports with release artifacts for compatibility reviews.

## Release and rollback

- Run `pnpm run verify`, `pnpm run docs:check`, and relevant smoke tests before
  deploying.
- Confirm package versions, changelogs, and release notes match the deployed
  commit.
- Prefer deprecation or corrective patch releases over republishing existing npm
  versions.

## Registry metrics exposure

- Treat `/metrics` and `/metrics/summary` as operational surfaces. In production, place them behind network policy, reverse-proxy authentication, or a private observability network unless the deployment intentionally exposes aggregate registry health publicly.
- Do not publish tenant-specific task, agent, or health details through metrics without a privacy review.
