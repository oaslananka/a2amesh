# Fleet Policy, Sandbox, Artifact, and Approval Boundaries

Fleet workers must not perform high-impact operations until policy, sandbox, artifact, and approval boundaries are explicit. This document defines the post-1.0 contract that sits between the Fleet control plane, worker runtime, artifact layer, and Mission Control.

## Side-effect levels

| Level          | Examples                                                                  | Default action                                                            |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `read-only`    | Inspect files, read registry metadata, run dry-run checks                 | Allowed with audit.                                                       |
| `local-write`  | Write temporary reports, create local patch files, update local artifacts | Allowed only inside the sandbox workspace.                                |
| `remote-write` | Push branches, create issues, update remote task state                    | Requires approval and audit.                                              |
| `publish`      | Publish packages, release artifacts, write to public registries           | Requires approval, release evidence, and audit.                           |
| `deploy`       | Deploy services, change infrastructure, mutate production state           | Requires explicit operator approval and incident-ready rollback evidence. |

Unknown side-effect levels fail closed.

## Approval boundary

Approval is represented by `FleetApprovalGate`:

```text
NOT_REQUIRED -> PENDING -> APPROVED
                      \-> REJECTED
                      \-> EXPIRED
```

Rules:

- `remote-write`, `publish`, and `deploy` require approval by default.
- Approval must name the reason, approver, expiry, and scope.
- Approval cannot be inferred from successful dry-run output.
- Rejected or expired approvals fail closed and require a new decision.
- Mission Control may request and record approval, but workers must enforce it before side effects.

## Sandbox boundary

Every worker run receives a `FleetSandboxProfile`.

Required sandbox fields:

- isolation mode: `process`, `container`, `vm`, or `remote-runner`
- network mode: `disabled`, `allowlisted`, or `egress-proxy`
- filesystem mode: `read-only`, `workspace-write`, or `ephemeral-write`
- optional command allowlist and blocklist
- optional host allowlist
- optional runtime budget

Default production posture:

- no ambient credentials;
- no access to browser sessions or provider web UI state;
- outbound network disabled or allowlisted;
- write access limited to an ephemeral workspace;
- remote write commands blocked until approval is granted.

## Artifact boundary

Worker artifacts are controlled by `FleetArtifactPolicy`.

Required guarantees:

- artifact type must be allowed;
- checksum is required for persisted artifacts;
- redaction is required before diagnostic or support sharing;
- retention is explicit;
- confidential or restricted artifacts must not be sent to untrusted workers;
- raw task input should not be stored when summary, hash, or diff evidence is enough.

## Admission decision

A worker run starts only after `FleetWorkerRunAdmission` is produced. The admission decision includes:

- selected task and worker IDs;
- policy decision;
- sandbox profile;
- artifact policy;
- approval state;
- side-effect boundaries;
- evidence strings for audit and debugging.

If policy cannot classify the requested operation, the decision must be `allowed: false`.

## Responsibility split

| Component           | Responsibility                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Fleet control plane | Builds routing and admission inputs; records evidence.                                   |
| Policy layer        | Decides whether the run is allowed and what approvals are required.                      |
| Worker runtime      | Enforces sandbox, command, network, filesystem, and artifact rules.                      |
| Artifact layer      | Stores only approved artifact types with checksum, retention, and redaction.             |
| Mission Control     | Shows decisions, collects human approvals, and records audit trail.                      |
| Provider adapters   | Execute only through documented provider surfaces and only inside the admitted boundary. |

## Non-goals

Fleet must not:

- scrape provider web UIs;
- extract browser session tokens;
- bypass subscription, quota, or rate limits;
- perform remote write, publish, or deploy actions without approval;
- persist raw secrets, cookies, or private task input values in artifacts.

## Validation

```bash
pnpm --filter @a2amesh/internal-fleet run typecheck
pnpm exec vitest run --project unit packages/fleet/tests/domain.test.ts
pnpm run lint:md
pnpm run docs:check
```
