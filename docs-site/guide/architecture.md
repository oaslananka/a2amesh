# Architecture

The canonical architecture document lives in
[docs/development/architecture.md](https://github.com/oaslananka/a2amesh/blob/main/docs/development/architecture.md).

It covers package dependency direction, runtime request flow, JSON-RPC dispatch, task
lifecycle, storage, registry polling, outbound URL policy, auth, telemetry, release flow,
and the tests and ADRs that protect those decisions.

## Package Direction

```text
types/schemas -> core runtime -> transports -> client/registry -> adapters/bridges -> CLI/apps
```

`packages/runtime` owns protocol types, schemas, runtime, client primitives, storage,
and outbound network policy. Auth and telemetry live in separate packages
(`packages/auth`, `packages/telemetry`) and are re-exported through `packages/runtime`.
Transports, registry, adapters, bridges, CLI, apps,
docs-site, and examples consume public package APIs above that layer.

## Outbound boundary

Runtime clients, registry polling, callbacks, adapters, MCP bridges, and CLI commands use
one outbound policy. Redirect targets are revalidated, DNS answers are pinned to the
connection, and a total deadline remains active through body or SSE consumption. Response
bytes and SSE events are bounded, non-idempotent retries require an idempotency key, and
query values and credential-shaped headers are redacted from telemetry.

See the canonical [SSRF policy](https://github.com/oaslananka/a2amesh/blob/main/docs/security/ssrf.md)
and [ADR-0006](https://github.com/oaslananka/a2amesh/blob/main/docs/architecture/adr/0006-outbound-network-policy.md).

## Workspace graph

Run the graph check when package boundaries change:

```bash
node scripts/check-workspace-graph.mjs --summary
```

Expected summary:

```text
Workspace graph validation passed.
Checked 8 public package import aliases across 36 forbidden dependency edges.
Dependency direction: types/schemas -> core runtime -> transports -> registry -> adapters/bridges -> CLI/apps.
```

## Verification Links

- [ADR index](https://github.com/oaslananka/a2amesh/blob/main/docs/architecture/adr/index.md)
- [Client/server integration tests](https://github.com/oaslananka/a2amesh/blob/main/tests/integration/client-server.test.ts)
- [Transport contract helper](https://github.com/oaslananka/a2amesh/blob/main/tests/transport-contract/transportContract.ts)
- [Task lifecycle property tests](https://github.com/oaslananka/a2amesh/blob/main/packages/runtime/tests/properties/task-lifecycle.property.test.ts)
- [Telemetry snapshot tests](https://github.com/oaslananka/a2amesh/blob/main/packages/runtime/tests/telemetry-snapshots.test.ts)
- [Release artifact tests](https://github.com/oaslananka/a2amesh/blob/main/tests/integration/release-artifacts.test.ts)
