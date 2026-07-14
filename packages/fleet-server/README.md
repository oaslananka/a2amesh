# @a2amesh/internal-fleet-server

Fleet control-plane HTTP server: live worker health (backed by
`@a2amesh/internal-fleet`'s `RegistryWorkerDirectory` against a running
`@a2amesh/registry` instance), task routing, an operator approval queue for
gated side effects, artifact review, and an append-only audit timeline — the
server-side surface Mission Control needs.

See the [Fleet Control Plane Server guide](../../docs/fleet/control-plane-server.md) for the full route reference and [ADR-0012](../../docs/architecture/adr/0012-fleet-control-plane-server.md) for the design rationale.

## Status

This is an internal workspace package. It is private, not published to npm, not part of the first public alpha install surface, and not a stable public API.

## Workspace usage

This package is consumed inside the A2A Mesh monorepo through workspace dependencies. Do not install it directly from npm.

## Compatibility

See the workspace [Compatibility](../../docs/compatibility.md) matrix for supported Node.js and pnpm versions.

## Security boundary

Production mode requires authentication, binds to loopback by default, rejects wildcard CORS, enforces Fleet RBAC and tenant isolation, derives audit actors from verified principals, and uses atomic approval/rejection transitions. See the Fleet Control Plane Server guide for the role matrix and deployment configuration.
