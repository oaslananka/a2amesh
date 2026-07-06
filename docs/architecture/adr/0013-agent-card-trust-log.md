# ADR-0013: Agent Card Trust Log

## Status

Accepted.

## Context

`packages/runtime/src/security/AgentCardSigner.ts` already signs and verifies Agent
Cards (`signAgentCard`/`verifyAgentCard`, JWS via `jose`, `ES256`/`RS256`/`EdDSA`), and
`packages/registry/src/server/routes.ts`'s `registerAgent` handler already computes a
per-registration `AgentCardVerificationMetadata` (`required`, `valid`, `state:
'trusted' | 'unverified' | 'rejected'`, `verifiedAt`, `keyId?`, `tenantId?`,
`failureReason?`) and stores it on the `RegisteredAgent` record (see
`docs/packages/registry.md`'s "Tenant Trust and Signed Agent Cards" section). That
metadata answers "was this registration trusted right now?" but there was no way to
answer "has this Agent Card, or this signing key, ever been used in a trusted
registration, and can I prove that history hasn't been rewritten?" — a registry that
stores only the current state of each agent has no record once an agent
re-registers, rotates keys, or is deleted. ADR-0011 already established the
project's tamper-evidence pattern (a `sha256` hash chain seeded from a genesis value,
each entry's hash folding in the previous entry's hash plus the entry's own
canonical-JSON content) for cassette record/replay, and explicitly called out that
"no signing/trust-chain helper exists yet ... searched: no `Ed25519`, `trust-log`" —
this ADR is that follow-up.

## Decision

### `hashAgentCard`/`canonicalizeAgentCard`: reuse the signer's own canonicalization

`AgentCardSigner.ts` gains two new exports, `canonicalizeAgentCard` (the exact
signature-less, key-sorted JSON string `signAgentCard`/`verifyAgentCard` already sign
and verify internally) and `hashAgentCard` (its SHA-256 hex digest). These are thin
wrappers around the signer's existing private `canonicalize` helper, not a new
canonicalization scheme — a `cardHash` computed here is guaranteed to match what was
actually signed, because it is derived from the same code path rather than a
independently-reimplemented serialization that could silently drift from it.

### `ITrustLogStorage`/`InMemoryTrustLogStorage`: append-only, hash-chained, storage-swappable

Mirrors the storage-interface pattern already established by `IAgentStorage` and
`IFleetStorage` (ADR-0012): a narrow interface (`append`, `list`) with one in-memory
implementation today. Each `TrustLogEntry` carries a monotonic `sequence`, the
registration's `cardHash`, `keyId`, `algorithm`, `agentUrl`, optional `tenantId`, a
`timestamp`, and an `entryHash`. `entryHash[i] = sha256(entryHash[i-1] +
canonicalJson({ ...entry_i, sequence: i }))`, seeded from `sha256("a2amesh-trust-log-
genesis")` — the same shape as ADR-0011's cassette integrity hash and
`packages/fleet-server`'s audit journal, reimplemented locally per ADR-0011's
precedent (each package canonicalizes its own hash-chain input rather than importing
a shared helper from a package above it in the dependency direction). `list()`
returns defensive copies and supports filtering by `cardHash` and truncating to the
most recent `limit` entries.

### Append point: only on `state === 'trusted'`, inside `registerAgent`

The trust log is appended to from exactly one place: `registerAgent` in
`packages/registry/src/server/routes.ts`, immediately after `verifyRegistryAgentCard`
resolves `verification.state === 'trusted'` (and thus has a `verification.keyId`).
Unsigned, unverified, and rejected registrations never produce an entry — the log
answers "when was a trusted key used," not "every registration attempt." No entry is
appended on heartbeat, export/import, or deletion; the log is a record of trust
decisions, not agent lifecycle events (that is what `RegisteredAgent.status` and the
existing audit/metrics surfaces are for).

### Read surface: public, unauthenticated, read-only

`GET /trust-log` (optionally `?limit=`) and `GET /trust-log/:cardHash` require no
bearer token, matching `/health`'s and `/metrics`'s existing unauthenticated-read
posture rather than the `bearerAuth`-gated `/agents`/`/admin/*` routes. A trust log
entry contains no tenant-private data beyond a `tenantId` label already exposed by
public Agent Card search results, and the entire value of a tamper-evident log is
that a third party — not just an authenticated tenant — can independently verify the
chain has not been rewritten. Gating it behind auth would undermine the "prove it to
an outside auditor" use case this ADR exists to serve.

### CLI: `a2amesh trust sign|verify|log` — no new crypto, just wiring

`packages/cli/src/commands/trust.ts` adds three subcommands that call existing,
already-tested primitives rather than reimplementing anything: `sign` calls
`signAgentCard` with a private key read from a PEM file; `verify` calls
`verifyAgentCard` against one or more `keyId:pemPath` trusted keys (a repeatable
`--trusted-key` option, parsed by a small `keyId:path` splitter — deliberately not a
full URI/DSN parser, since the only separator that matters is the first `:`); `log`
calls a new `AgentRegistryClient.getTrustLog()` method (mirroring
`listAgents`/`exportAgents`'s existing fetch-and-throw-on-non-2xx shape) against a
running registry's `GET /trust-log*` routes. `verify`'s exit code is `1` when the
signature does not validate, matching the existing `a2amesh replay` convention of a
non-zero exit code on integrity failure (ADR-0011) so the command is scriptable in CI.

## Consequences

A registry can now answer "what trusted Agent Card registrations has this instance
ever recorded, and can I prove none of them were altered after the fact?" without any
new infrastructure dependency (no external transparency log, no Sigstore/keyless
signing — deliberately deferred, matching this repository's default-off cost model
for optional infrastructure) and without changing the existing verification-metadata
behavior on `RegisteredAgent`. `InMemoryTrustLogStorage` means the log does not
survive a process restart, the same known limitation `InMemoryFleetStorage` accepted
in ADR-0012 for a first surface — a durable backend can implement `ITrustLogStorage`
without touching `RegistryServer`, `routes.ts`, or the CLI. The read-only, public
`/trust-log*` routes mean any registry operator choosing to run this feature is
explicitly opting into a public audit trail of which signing keys registered which
agents; operators who consider even that metadata sensitive should not enable
`requireSignedAgentCards`/`trustedAgentCardKeys` on a registry whose `/trust-log`
route is reachable by untrusted parties.

## Validation Commands

```bash
pnpm run lint:md
pnpm run docs:build
pnpm run openapi:check
pnpm --filter @a2amesh/runtime run test
pnpm --filter @a2amesh/registry run test
pnpm --filter @a2amesh/cli run test
```

Relevant coverage:

- [`InMemoryTrustLogStorage tests`](../../../packages/registry/tests/trust-log-storage.test.ts)
- [`Registry trust log route tests`](../../../packages/registry/tests/RegistryServerModules.test.ts)
- [`a2amesh trust command tests`](../../../packages/cli/tests/trust-command.test.ts)
