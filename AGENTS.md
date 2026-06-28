# A2A Mesh Agent Map

## What This Repository Is

A2A Mesh is an independent TypeScript monorepo for Agent2Agent-compatible runtime, client, registry, adapters, bridge packages, CLI, docs, and tests.

Use `A2A Mesh` for human-facing project identity and `a2amesh` for machine names. Public packages are scoped under `@a2amesh/*` except `create-a2amesh`.

## Setup

Use the repository toolchain:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Supported runtime is Node.js `>=22.22.1 <25` and pnpm `>=11 <12`.

## Build And Test

Run the narrowest relevant command first, then the broader gate:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify
```

`pnpm run verify` is the local release-quality gate. Do not bypass failing checks.

## Repository Layout

- `.github/`: workflows, issue templates, repo ruleset examples, and ownership.
- `packages/runtime/`: public runtime, protocol types, server/client, auth, storage, telemetry, and security helpers.
- `packages/protocol/`: `@a2amesh/protocol` — standalone protocol type definitions (zero deps).
- `packages/client/`: standalone client re-exports.
- `packages/adapters/`: **deprecated** — meta-package re-exporting per-provider adapter packages.
- `packages/adapter-base/`: abstract base adapter and contract helpers.
- `packages/adapter-openai/`: OpenAI Chat API adapter.
- `packages/adapter-anthropic/`: Anthropic Claude Messages API adapter.
- `packages/adapter-langchain/`: LangChain / LangGraph runnable adapter.
- `packages/adapter-google-adk/`: Google Agent Development Kit HTTP adapter.
- `packages/adapter-llamaindex/`: LlamaIndex query/chat engine adapter.
- `packages/adapter-crewai/`: CrewAI HTTP bridge adapter.
- `packages/registry/`: registry server, discovery, health, matching, and storage helpers.
- `packages/mcp/`: A2A and MCP mapping helpers.
- `packages/transport-ws/`: WebSocket transport helpers.
- `packages/transport-grpc/`: gRPC transport helpers.
- `packages/testing/`: fixtures, matchers, and local server helpers.
- `packages/codex-bridge/`: Codex-style tool bridge helpers.
- `packages/create-a2amesh/`: `create-a2amesh` scaffolder.
- `packages/cli/`: `a2amesh` command-line interface.
- `apps/`: demos and UI smoke surfaces.
- `docs/`: canonical markdown documentation.
- `docs-site/`: VitePress site that mirrors the canonical docs topics.
- `scripts/`: repository validation, docs generation, release, and cleanup scripts.
- `tests/`: cross-package integration tests.

## Package Boundaries

Respect this dependency direction:

```text
types/schemas -> core utilities -> protocol runtime -> transports -> client SDK -> registry -> adapters -> bridges -> CLI/apps
```

`packages/runtime` must not import adapters, registry, CLI, apps, docs-site, or bridge packages.

`packages/client` may import public core APIs only.

`packages/registry` may import public core APIs, not adapter or bridge internals.

`packages/adapters` (deprecated meta-package) may import public core APIs and individual adapter packages, not registry server internals.

`packages/adapter-base` must not import any other adapter package. Each `packages/adapter-*` may import `packages/adapter-base` and public core APIs, not registry server internals.

`packages/protocol` must import zero packages (bottom of dependency graph).

`packages/mcp` may import core/client public APIs and MCP-specific types only.

`packages/cli` may import public package APIs and must not import app internals.

`apps/*` may depend on packages, never the reverse.

`docs-site` must not import runtime source directly.

## Public API Rules

Every publishable package needs explicit `exports`, `types`, `files`, repository metadata, bugs URL, homepage, Apache-2.0 license, and a release-managed version matching `.release-please-manifest.json`.

Public exports must match the checked-in `public-surface.json` inventories.

Do not add accidental deep imports. If a new export is intentional, update the inventory and tests.

Do not ship placeholder APIs, unimplemented stubs, commented-out skeletons, or undocumented throws.

## Docs Rules

Canonical docs live under `docs/`.

CLI examples must use `a2amesh` and pass `scripts/check-docs-commands.mjs`.

Package docs must stay aligned with `package.json` names and pass `scripts/check-docs-package-parity.mjs`.

Do not claim deployment surfaces, provider support, or security controls unless CI or tests cover them.

The migration doc is the only normal place for the old private identity.

## Release Rules

Release Please may create release PRs and changelog updates only.

Normal CI must not publish npm packages, push container images, create tags, or create GitHub Releases.

Publishing is owner-triggered through `publish.yml` with explicit confirmation and npm Trusted Publishing/OIDC.

Do not introduce long-lived npm registry token secrets, fallback registry token logic, self-hosted release runners, or fail-open required checks.

## Identity Cleanup Checks

Run these after identity-sensitive changes:

```bash
pnpm run lint:identity
node scripts/check-release-config.mjs
node scripts/check-public-surface.mjs
```

`scripts/check-identity.mjs` enforces stale identity rules.

`scripts/check-forbidden-refs.mjs` blocks unsupported deployment/publish references and user-facing hype language.

`scripts/check-no-generated-artifacts.mjs` blocks dependency, build, coverage, and cache artifacts.

## Common Tasks

Add a runtime feature:

1. Add or update behavior tests first.
2. Implement in the smallest package that owns the behavior.
3. Update public exports only if the feature is public.
4. Run package tests, typecheck, and `pnpm run verify:structure`.

Add a CLI command:

1. Add command tests under `packages/cli/tests/`.
2. Implement in `packages/cli/src/`.
3. Update `docs/cli/`.
4. Run `pnpm run docs:check` and CLI tests.

Add an adapter:

1. Keep provider SDKs optional where possible.
2. Use fake provider tests by default.
3. Keep live provider tests opt-in.
4. Document supported behavior in `docs/adapters/`.

Update workflows:

1. Use GitHub-hosted runners only.
2. Pin third-party actions.
3. Keep top-level `permissions: contents: read`.
4. Run actionlint/zizmor locally where available.

Before final handoff:

1. Run `git status --short`.
2. Run the relevant local verification chain.
3. Record any real external blockers in untracked `NEXT.md`.
