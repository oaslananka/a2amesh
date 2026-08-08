# A2A Mesh Open Issues Triage & Roadmap

> **Historical snapshot — observed 2026-06-27.** This document preserves migration-era issue triage and is not the current roadmap or issue/milestone source of truth. See the [current roadmap](../../ROADMAP.md).

**Date**: 2026-06-27  
**Status**: Historical repository-backup triage snapshot

This document triages the 71 open issues imported from the backup of the historical `a2a-warp` repository. It groups them logically into milestones from clean-start validation to stable releases and the future post-1.0 Fleet control plane.

---

## Milestone Summary

| Milestone | Focus Area                              | Issues     | Target           |
| --------- | --------------------------------------- | ---------- | ---------------- |
| M0        | Clean Start Verification                | 4 trackers | 0.1.0-alpha.0    |
| M1        | Protocol & Runtime Conformance          | 6 issues   | Before 1.0       |
| M2        | Security & MCP Hardening                | 6 issues   | Before 1.0       |
| M3        | Registry & Storage Production Readiness | 6 issues   | Before 1.0       |
| M4–M5     | Fleet & Control Plane (Post-1.0)        | 11 issues  | After 1.0        |
| —         | Closed/Historical (archived)            | 83 issues  | Already resolved |

**Total active**: 29 tracked issues. **Remaining 42** of 71 require no action until their milestone is entered.

---

## Triage Categories & Milestones

### A. Milestone 0: Clean Start Verification (Release Blockers for 0.1.0-alpha.0) — 4 Trackers

These cover the initial A2A Mesh clean-start baseline. All must pass locally before the first alpha release:

- **Package & Docs Parity**: Ensure docs/package manifest names match and only public packages are exposed.
- **Compatibility Matrix**: Align all packages with the `0.1.0-alpha.0` version line.
- **Identity & Name Purge**: Remove references to historical naming and obsolete migration scripts in active code.
- **Validation Gates**: Ensure all local CI linters, typecheckers, and unit tests pass. ✅ (Verified 2026-06-28)

### B. Milestone 1: Protocol & Runtime Conformance (Blockers before 1.0) — 6 Issues

Align A2A Mesh with A2A v1.0 specification and resolve runtime issues:

- **#315**: A2A task lifecycle and send configuration alignment.
- **#342**: A2A v1.0 strict conformance epic.
- **#343**: Enforce `A2A-Version` negotiation across JSON-RPC, REST, SSE, gRPC, and WebSocket transports.
- **#344**: Finalize A2A HTTP+JSON media type, problem details, pagination, and tenant semantics.
- **#345**: Implement official `TaskPushNotificationConfig` CRUD with multi-config storage.
- **#349**: Expand strict A2A v1.0 conformance fixtures and make required gaps block CI.

### C. Milestone 2: Security & MCP Hardening (Blockers before 1.0) — 6 Issues

Security boundaries must be default-deny:

- **#348**: Make task ownership and tenant isolation default-deny in authenticated deployments.
- **#351**: Security and agent-safety hardening for production A2A/MCP runtimes.
- **#353**: Protect metrics, health, logs, and ensure sensitive credential redaction.
- **#355**: Add OAuth audience validation and credential-boundary guardrails to the MCP bridge.
- **#356**: Implement human approval gates, tool risk scoring, dry-run mode, and audit hooks for MCP tool calls.
- **#357**: Add indirect-instruction and tool-manifest abuse defenses.

### D. Milestone 3: Registry & Storage Production Readiness (Blockers before 1.0) — 6 Issues

Make the runtime data store and registry metadata ready for high-availability production environments:

- **#360**: Production-grade task storage with migrations, WAL indexes, TTL, audit journal, and large artifacts.
- **#361**: Registry control-plane hardening for tenant trust lifecycles and signed Agent Cards.
- **#362**: Production hardening for Redis storage and distributed health polling.
- **#363**: Observability: publish dashboards, SLOs, semantic conventions, and diagnostic bundles.
- **#366**: Supply chain: publish SBOM, SLSA provenance, and package verification guides.
- **#373**: Automatically generate and diff JSON Schema, OpenAPI, protobuf, and TypeScript type surfaces.

### E. Milestones 4 & 5: Fleet & Control Plane (Post-1.0 Roadmap) — 11 Issues

Future orchestration plane, sandbox environments, and provider integrations:

- **#382**: Fleet orchestration control plane and routing architecture.
- **#387**: Epic: build domain model, worker runtime, and registry foundation.
- **#390**: Define provider-neutral worker lifecycle contract (`packages/worker-runtime`).
- **#393**: Epic: policy, artifacts, and sandboxed execution safety layer.
- **#394**: Implement command, file, network, git, and publish policy engine.
- **#397**: Sandboxing: implement git worktree isolation and cleanup manager.
- **#400**: Epic: OpenCode, OpenRouter, and local issue-to-commit workflows.
- **#407**: Epic: multi-agent review chains and Mission Control UI.
- **#414**: Epic: integrate Claude Code, Codex, Gemini, Antigravity, and GitHub Actions workers.
- **#418**: Antigravity worker workspace bridge integration.
- **#421**: Publish provider capability matrix and integration support policy.

### F. Closed/Historical Issues — 83 Issues (Archived)

The 83 closed issues in the backup directory are archived. They remain resolved and will not be imported into the active roadmap unless a regression is detected.

---

## Execution Guidelines

1. **Do Not Import All 71 Issues Blindly**: When creating the new GitHub repository, only import active Milestone 1 & 2 issues first to keep the tracker focused.
2. **Recreate under @a2amesh**: Update all issue templates and references to use the `@a2amesh` scope and clean-start naming.
3. **Roadmap Milestones**:
   - **M0**: Clean Start Verification ✅ (Complete locally)
   - **M1**: Protocol + Runtime Conformance (Core)
   - **M2**: Security + MCP Hardening (Safety)
   - **M3**: Registry Production Readiness (Ops)
   - **M4**: 1.0 Release Candidate
   - **M5**: Fleet & Mission Control Alpha (Orchestration)
