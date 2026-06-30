# Active GitHub Tracker Plan — 2026-06-30

This plan converts the historical `pre-rename project` issue backup and the 2026-06-30 `a2amesh` audit into a clean, importable `a2amesh` issue tracker.

## Created milestones

1. M0 — Release Recovery & Repo Health
2. M1 — A2A v1.0 Protocol Conformance
3. M2 — Security & MCP Hardening
4. M3 — Registry & Production Readiness
5. M4 — DX, Docs & Ecosystem Trust
6. M5 — Fleet & Control Plane (Post-1.0)

## P0 / M0 — Release Recovery & Repo Health

These must be fixed before bestpractice.dev evidence work or a trusted release rerun.

1. fix(release): remove hardcoded alpha version from release config validation
   - Source: 2026-06-30 audit
   - Verify: `pnpm run verify:structure && node scripts/check-release-config.mjs`

2. fix(docs): restore package/docs parity for @a2amesh/create-a2amesh
   - Source: 2026-06-30 audit
   - Verify: `pnpm run docs:check && pnpm run lint:identity`

3. fix(release): enable npm publish for @a2amesh/create-a2amesh with Trusted Publishing
   - Source: 2026-06-30 publish failure
   - Verify: `npm view @a2amesh/create-a2amesh dist-tags --json`

4. fix(release): validate prerelease registry parity against dist-tags instead of latest
   - Source: 2026-06-30 audit
   - Verify: `node scripts/check-package-registry-parity.mjs`

5. fix(ci): restore unit coverage thresholds without lowering the quality gate
   - Source: CI coverage regression
   - Verify: `pnpm run test:unit`

6. fix(interop): rename stale warp golden traces and repair interop lab matrix
   - Source: Interop Lab failure
   - Verify: `pnpm run interop:lab && pnpm run lint:identity`

7. fix(packaging): prevent bin wrapper chmod from dirtying the working tree
   - Source: local pack artifact audit
   - Verify: `pnpm run pack:dry-run && test -z "$(git status --short)"`

8. chore(governance): add branch ruleset and required checks for main
   - Source: repo ruleset audit
   - Verify: `gh api repos/oaslananka/a2amesh/rulesets`

9. chore(license): make GitHub detect the repository as Apache-2.0
   - Source: GitHub metadata audit
   - Verify: `gh repo view oaslananka/a2amesh --json licenseInfo`

## P1 / M1 — A2A v1.0 Protocol Conformance

1. feat(protocol): align task lifecycle and message send configuration with A2A v1.0
   - Historical source: #315

2. epic(conformance): close strict official-a2a-v1.0 profile gaps and make them CI-blocking
   - Historical source: #342, #349

3. feat(protocol): enforce A2A-Version negotiation across HTTP, SSE, WebSocket, and gRPC
   - Historical source: #343

4. feat(protocol): finalize HTTP+JSON semantics, media types, errors, pagination, and tenant behavior
   - Historical source: #344

5. feat(runtime): implement official TaskPushNotificationConfig multi-config CRUD
   - Historical source: #345

## P1 / M2 — Security & MCP Hardening

1. security(runtime): make tenant isolation and task ownership default-deny
   - Historical source: #348

2. security(mcp): add OAuth audience validation and auth-boundary guardrails
   - Historical source: #355

3. security(mcp): implement human approval gates, tool risk scoring, dry-run mode, and audit hooks
   - Historical source: #356

4. security(runtime): defend against indirect instruction and tool-manifest abuse
   - Historical source: #357

5. security(observability): protect metrics, health, logs, and sensitive-value redaction
   - Historical source: #353

## P1/P2 / M3 — Registry & Production Readiness

1. feat(storage): add production-grade task storage migrations, WAL/indexes, TTL, audit journal, and artifact handling
   - Historical source: #360

2. feat(registry): harden tenant trust lifecycles and signed Agent Card handling
   - Historical source: #361

3. feat(registry): harden Redis storage and distributed health polling
   - Historical source: #362

4. feat(observability): publish dashboards, SLOs, semantic conventions, and diagnostic bundles
   - Historical source: #363

5. chore(api): generate and diff JSON Schema, OpenAPI, protobuf, and TypeScript surfaces
   - Historical source: #373

## P1/P2 / M4 — DX, Docs & Ecosystem Trust

1. docs(trust): complete bestpractice.dev evidence and OpenSSF badge/readme signal set
   - Source: 2026-06-30 bestpractice.dev audit

2. feat(cli): strengthen doctor, conformance, and release-check commands as local release gates
   - Historical source: #365

3. docs(supply-chain): publish SBOM, provenance, and package verification guide
   - Historical source: #366

## Roadmap / M5 — Fleet & Control Plane (Post-1.0)

1. epic(fleet): define post-1.0 Fleet orchestration control plane and routing architecture
   - Historical source: #382 and related Fleet roadmap

2. epic(fleet): implement policy, artifacts, sandboxing, and safe side-effect boundaries
   - Historical source: #393, #394, #397

3. epic(fleet): plan provider workers and Mission Control without unsafe session scraping
   - Historical source: #400, #407, #414, #418, #421

## Do not import directly

The remaining historical issues should remain archived unless a concrete regression is found. Do not blindly import all 71 open backup issues into the clean `a2amesh` tracker.
