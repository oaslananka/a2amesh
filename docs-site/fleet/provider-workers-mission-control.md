# Provider Workers and Mission Control Plan

Fleet provider workers run only through documented integration surfaces. Mission Control is the operator surface for health, routing evidence, approvals, artifacts, and incidents. It is not a browser automation layer and must never scrape provider sessions.

## Implementation status

`@a2amesh/internal-worker-openai-compatible` is the experimental remote API worker. It implements the full Fleet worker lifecycle for bounded text-only inference through a caller-supplied official OpenAI-compatible client.

`@a2amesh/internal-worker-cli` is the experimental official CLI worker. It validates the documented provider surface and a task-bound `FleetWorkerRunAdmission` before delegating execution to the confined `LocalCliWorkerRuntimeAdapter`. It accepts named environment references or an existing official CLI session, requires explicit approval for local worktree mutation, and denies remote-write, publish, and deploy side effects.

`@a2amesh/internal-worker-mcp` is the experimental MCP worker. It invokes one allowlisted documented MCP tool through a caller-supplied client, binds the call to task-level Fleet admission, requires approval for local worktree mutation, and returns bounded checksummed text artifacts with credential-safe failures.

GitHub Action, webhook, service-account cloud, and manual-handoff workers remain planned.

The [OpenAI-compatible provider example](https://github.com/oaslananka/a2amesh/tree/main/examples/openai-compatible-provider) provides a network-free remote-provider proof. The [local CLI Fleet example](https://github.com/oaslananka/a2amesh/tree/main/examples/local-cli-fleet) routes a task through the policy-backed official CLI worker using only the canonical Node.js stand-in and a confined checksummed patch artifact. The [MCP bridge example](https://github.com/oaslananka/a2amesh/tree/main/examples/mcp-bridge) adds a network-free Fleet lifecycle proof using an injected fake MCP client and a checksummed artifact.

## Supported integration surfaces

| Surface             | Status                | Notes                                                                                                               |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Official API        | Supported             | Use provider-issued API keys, OAuth tokens, service accounts, or documented SDKs.                                   |
| Official CLI        | Supported with policy | Invoke the vendor CLI directly and treat CLI credentials as local user/session references, not extractable secrets. |
| MCP server          | Supported with policy | Use documented MCP tools and resource contracts. Apply approval and audit boundaries before side effects.           |
| GitHub Action       | Supported with policy | Use documented action inputs, permissions, and artifact outputs.                                                    |
| Webhook             | Supported with policy | Validate signatures and source identity before accepting events.                                                    |
| Workspace extension | Experimental          | Use documented extension APIs only. Do not inspect internal UI buffers or private databases.                        |
| Git worktree        | Supported             | Use explicit worktree, diff, and artifact handoff for code tasks.                                                   |
| Artifact handoff    | Supported             | Use checksummed, redacted, retention-scoped artifacts.                                                              |
| Manual handoff      | Supported             | Use when no safe automation surface exists.                                                                         |

## Forbidden surfaces

| Surface                    | Policy                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Browser session automation | Forbidden. Do not drive provider web apps to bypass API or subscription boundaries.          |
| Web UI scraping            | Forbidden. Do not parse DOM, screenshots, or rendered provider UI as an automation API.      |
| Private endpoints          | Forbidden. Do not call undocumented internal provider endpoints.                             |
| Token extraction           | Forbidden. Do not extract browser cookies, local storage tokens, or internal session tokens. |
| Subscription bypass        | Forbidden. Do not evade quotas, subscriptions, rate limits, or billing boundaries.           |

## Provider capability matrix

| Provider family                     | Planned worker role  | Allowed surfaces                                            | Support policy                                                                        |
| ----------------------------------- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OpenRouter-style API providers      | `model-router`       | Official API, webhook, artifact handoff                     | Supported when credentials are secret-manager references and rate limits are honored. |
| Claude Code-style CLI providers     | `code-worker`        | Official CLI, MCP, git worktree, artifact handoff           | Experimental. Human handoff required for remote writes and publish/deploy actions.    |
| Codex-style CLI or action providers | `code-review-worker` | Official CLI, GitHub Action, git worktree, artifact handoff | Experimental. Approval required for repository mutation.                              |
| Gemini/Vertex-style cloud providers | `model-worker`       | Official API, service account, artifact handoff             | Supported when cloud IAM and billing boundaries are explicit.                         |
| Workspace-only providers            | `manual-handoff`     | Manual handoff, documented extension API if available       | Manual-only until a documented automation surface exists.                             |

## Mission Control capabilities

Mission Control may expose:

- worker health;
- routing evidence;
- approval queue;
- artifact review;
- audit timeline;
- incident handoff;
- manual runbooks.

Mission Control must not expose:

- browser session scraping;
- private provider token extraction;
- unsupported web UI automation;
- automatic subscription bypass;
- hidden remote side effects.

## Planning contract

The domain contract lives in `MissionControlPlan` and `FleetProviderWorkerPlan`.

Required fields:

- provider ID;
- worker role;
- support status;
- allowed documented surfaces;
- forbidden unsafe surfaces;
- provider capabilities;
- credential policy;
- human-handoff requirement where needed.

The `unsafeSessionScrapingAllowed` field is typed as `false` and must remain false.

## Operator policy

When a provider does not expose a documented automation surface, Fleet must choose manual handoff instead of inventing a web automation integration. This keeps provider subscriptions, billing, privacy, and security boundaries intact.

## Validation

```bash
pnpm --filter @a2amesh/internal-fleet run typecheck
pnpm --filter @a2amesh/internal-worker-cli run test
pnpm --filter @a2amesh/internal-worker-mcp run test
pnpm --filter @a2amesh/runtime-example-local-cli-fleet run smoke
pnpm --filter @a2amesh/runtime-example-mcp-bridge run smoke
pnpm exec vitest run --project unit packages/fleet/tests/domain.test.ts
pnpm run lint:md
pnpm run docs:check
```
