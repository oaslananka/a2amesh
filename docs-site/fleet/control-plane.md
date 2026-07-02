# Fleet Control Plane Architecture

Fleet remains a post-1.0 layer above the provider-neutral A2A runtime. The control plane coordinates worker discovery, routing decisions, run admission, failure classification, and operator handoff. It does not execute provider-specific work directly.

## Control-plane responsibilities

| Responsibility         | Owner                     | Boundary                                                                                                         |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Worker discovery       | Fleet control plane       | Reads Worker Cards and health records from supported registry surfaces only.                                     |
| Capability indexing    | Fleet control plane       | Builds a queryable index from Worker Card capabilities, labels, roles, and tenant scope.                         |
| Routing decision       | Fleet control plane       | Selects candidate workers using capability, role, tenant, availability, policy, load, cost, and latency signals. |
| Run admission          | Policy and approval layer | Verifies task, tenant, side-effect, budget, and artifact constraints before a worker run starts.                 |
| Failure classification | Fleet control plane       | Converts worker/runtime outcomes into explicit failure classes and recovery actions.                             |
| Human handoff          | Mission Control or CLI    | Surfaces approval, incident, and manual intervention requests; it does not silently bypass policy.               |
| Artifact routing       | Artifact layer            | Routes run outputs to approved artifact stores and redacts diagnostic metadata.                                  |

## Routing flow

```text
A2A Task
  -> policy preflight
  -> capability and tenant index lookup
  -> candidate worker ranking
  -> admission decision
  -> worker run creation
  -> task/artifact status update
```

Routing must be deterministic for the same task, worker set, policy, and timestamp bucket. Production implementations may use richer ranking, but they must expose the signals used in the routing decision.

Required routing signals are represented in `FleetRoutingSignal`:

- `capability`
- `role`
- `tenant`
- `policy`
- `availability`
- `load`
- `affinity`
- `cost`
- `latency`

## Worker discovery contract

Workers are discovered through documented registry, runtime, or worker-runtime surfaces. A discovery record includes:

- `workerId`
- Worker Card
- current status
- discovered timestamp
- heartbeat timestamp
- capability list
- role list
- optional tenant scope
- labels used for scheduling and observability

Discovery records have a TTL. A worker without a fresh heartbeat must not receive new work unless an operator explicitly overrides the decision.

## Failure handling

Fleet failure handling is fail-closed by default.

| Failure class             | Default recovery action                 | Retryable                         |
| ------------------------- | --------------------------------------- | --------------------------------- |
| `WORKER_UNAVAILABLE`      | `ROUTE_TO_ALTERNATE_WORKER`             | Yes, bounded by max attempts.     |
| `CAPABILITY_MISMATCH`     | `QUEUE_FOR_CAPACITY` or `FAIL_CLOSED`   | Usually no.                       |
| `POLICY_DENIED`           | `FAIL_CLOSED`                           | No.                               |
| `TIMEOUT`                 | `RETRY_SAME_WORKER` or alternate worker | Yes, bounded by timeout budget.   |
| `ARTIFACT_REJECTED`       | `FAIL_CLOSED`                           | No until artifact policy changes. |
| `HUMAN_APPROVAL_REQUIRED` | `REQUEST_HUMAN_APPROVAL`                | No automatic retry.               |
| `UNKNOWN`                 | `OPEN_INCIDENT`                         | No automatic retry.               |

## Policy and artifact boundary

High-impact actions are gated by [Fleet Policy, Sandbox, Artifact, and Approval Boundaries](/fleet/policy-sandbox-artifacts). The control plane must produce routing evidence, but worker runtime and policy layers enforce sandbox, artifact, and approval constraints before side effects.

## Provider worker and Mission Control plan

Provider worker support and Mission Control capabilities are planned in [Provider Workers and Mission Control Plan](/fleet/provider-workers-mission-control). The plan keeps provider workers on documented integration surfaces and keeps Mission Control as an approval/evidence surface rather than a session automation layer.

## Mission Control boundary

Mission Control is an operator surface above the control plane. It may show routing evidence, health, failures, approval requests, and artifacts. It must not scrape provider web UIs, extract session tokens, bypass subscriptions, or perform remote side effects without explicit approval.

## Package boundary

The domain contract lives in `packages/fleet` and depends only on public A2A protocol/runtime types. Provider adapters and worker implementations stay above the Fleet package. The runtime package remains provider-neutral.

## Validation

The architecture is backed by Fleet domain tests and docs checks:

```bash
pnpm --filter @a2amesh/fleet run typecheck
pnpm exec vitest run --project unit packages/fleet/tests/domain.test.ts
pnpm run lint:md
pnpm run docs:check
```
