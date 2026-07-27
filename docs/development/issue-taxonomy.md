# Issue Taxonomy

## Canonical source of truth

`.github/labels.yml` is the canonical source of truth for GitHub labels. Issue forms,
`.github/labeler.yml`, Renovate configuration, and this document must reference only labels
from that file.

Use these commands when changing the taxonomy:

```bash
pnpm run labels:check
pnpm run labels:check-live
pnpm run labels:preview
pnpm run labels:apply
```

`pnpm run labels:check-live` fails when the live repository differs from the declaration.
`labels:preview` prints the create/update/delete plan without changing GitHub.
`labels:apply` is the only command that mutates live labels.

## Classification rules

Every actionable issue should have exactly one `type:*` label, one or more `area:*` labels after
triage, at most one `priority:*` label, and either `status:triaged` after review or
`status:blocked` while an external blocker exists.

A milestone is used only when an issue belongs to one delivery window. Cross-milestone umbrella
epics remain milestone-free and track milestone-owned child issues. GitHub issue state and Projects
carry normal workflow state; do not add status labels for in progress, review, or done.

## Types

- `type:adapter`: provider or framework adapter integration.
- `type:bug`: defect, regression, or broken workflow.
- `type:conformance`: protocol/spec conformance or compatibility work.
- `type:docs`: documentation or guide work.
- `type:epic`: umbrella issue coordinating multiple tasks.
- `type:feature`: new user-facing capability or product behavior.
- `type:release`: release, packaging, publishing, or registry work.
- `type:security`: security-sensitive hardening work.
- `type:task`: concrete implementation, maintenance, or bounded research task.

## Areas

- `area:ci`: workflows, checks, coverage, or required status gates.
- `area:cli`: commands, CLI UX, and command documentation.
- `area:deployment`: containers, orchestration manifests, environments, and rollout.
- `area:deps`: dependency updates and dependency lifecycle policy.
- `area:docs`: canonical docs, docs-site, architecture docs, and READMEs.
- `area:dx`: examples, onboarding, scaffolding, and local developer workflow.
- `area:fleet`: Fleet orchestration, workers, providers, and Mission Control.
- `area:governance`: contribution, review, branch, release, and project governance.
- `area:interop`: SDK fixtures, golden traces, compatibility matrices, and live interop.
- `area:mcp`: MCP bridge, mapping, compatibility, and MCP safety.
- `area:observability`: metrics, traces, logs, dashboards, alerts, and diagnostics.
- `area:protocol`: A2A types, schemas, lifecycle, and versioning.
- `area:registry`: registry, discovery, health, tenancy, trust, and API behavior.
- `area:release`: versions, tags, npm, release automation, and release artifacts.
- `area:runtime`: server/client runtime, tasks, auth, middleware, and runtime storage.
- `area:security`: threat models, authorization, sandboxing, logging, and abuse resistance.
- `area:storage`: persistence, migrations, TTL, audit journals, and artifacts.
- `area:supply-chain`: SBOM, provenance, lockfiles, dependency review, and package trust.
- `area:testing`: tests, coverage, mutation, fuzzing, fixtures, and verification policy.

## Priority

- `priority:P0`: release blocker or urgent repository-health issue.
- `priority:P1`: required before the active release train completes.
- `priority:P2`: important follow-up after core stabilization.
- `priority:roadmap`: strategic roadmap item, not a current release blocker.

Public issue forms do not assign priority; maintainers assign it during triage.

## Status

- `status:triaged`: reviewed and accepted into the active roadmap.
- `status:blocked`: blocked by an external dependency, account, or platform state.

## Package labels

PR automation may add `pkg:runtime`, `pkg:protocol`, `pkg:registry`, `pkg:cli`, `pkg:mcp`,
`pkg:adapters`, `pkg:transport-ws`, `pkg:transport-grpc`, or `pkg:testing`. Package labels
supplement rather than replace issue type and area labels.

## Functional labels

The supported functional labels are `duplicate`, `good first issue`, and `help wanted`. They do not
replace issue type or triage status.

## Deprecated labels

The parallel default labels `bug`, `documentation`, and `enhancement` are replaced by `type:bug`,
`type:docs`, and `type:feature`. The old `adapter`, `hardening`, and `triage` form labels are replaced
by structured type, area, and status labels. GitHub close reasons and Discussions replace `invalid`,
`wontfix`, and `question` labels.
