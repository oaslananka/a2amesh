# API, CLI, and tool stability

## Stability level

A2A Mesh packages are pre-1.0 alpha packages. Public surfaces should still be treated carefully because consumers may depend on runtime APIs, CLI commands, registry behavior, MCP tool contracts, and protocol compatibility behavior.

## Public surfaces

- Published package exports.
- CLI commands and flags.
- JSON-RPC and A2A protocol behavior.
- Registry HTTP API behavior.
- MCP bridge/tool schemas.
- Configuration and environment variables documented for users.

## Change policy

- Prefer additive changes.
- Include tests for changed behavior.
- Include migration notes for breaking or potentially breaking changes.
- Keep command-surface and public-surface checks green.
- Avoid mixing public API changes with repository maturity/docs PRs.

## Breaking changes

Breaking changes require explicit PR risk notes, release notes or changelog entries, migration guidance, and a versioning decision aligned with pre-1.0 semver policy.
