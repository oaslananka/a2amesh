# Architecture explanation

A2A Mesh is a TypeScript monorepo for A2A-native runtime, protocol, registry, CLI, MCP integration, adapters, and related operational tooling.

## Architectural maturity goals

- Keep protocol behavior testable and documented.
- Keep runtime, registry, and transport concerns isolated.
- Keep security-sensitive MCP and network boundaries explicit.
- Keep package surfaces stable and checked by public-surface gates.
- Keep generated artifacts reproducible and verified by CI.

## Existing deeper references

- `docs/development/architecture.md`
- `docs/protocol/`
- `docs/packages/`
- `docs/security/`
- `docs/operations/`
