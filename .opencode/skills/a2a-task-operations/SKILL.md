---
name: a2a-task-operations
description: Send, inspect, monitor, and cancel A2A tasks with explicit approval, bounded retries, and verifiable task evidence.
---

# A2A Task Operations

Use this skill for controlled A2A message and task lifecycle operations after endpoint validation is complete.

## When to use

Use this skill when the user asks to:

- send a text message to a validated A2A endpoint;
- inspect or monitor an existing task;
- retrieve task artifacts or status history; or
- cancel a known task with explicit approval.

Do not use this skill for unrestricted bulk dispatch, credential management, deployment, merge, publish, terminal, or destructive infrastructure operations.

## Required context

Confirm:

- the exact validated endpoint and tenant boundary;
- the intended message, task ID, or context ID;
- the authentication mechanism without exposing the credential value;
- whether the requested action is read-only or state-changing;
- the user's explicit approval for send or cancel operations; and
- the timeout, retry, and artifact-size expectations.

## Workflow

1. Reuse recent endpoint-validation evidence or run the `a2a-endpoint-validation` skill first.
2. For a send, restate the endpoint and bounded message purpose, then obtain explicit approval.
3. Run `pnpm dlx @a2amesh/cli@alpha send <endpoint> <message>` with only documented options.
4. Do not retry a non-idempotent send automatically. Use an `Idempotency-Key` only when the caller and endpoint contract support it.
5. Inspect a task with `task status` or monitor it with a bounded cycle count.
6. Retrieve and summarize artifacts without writing binary or secret-bearing content into chat.
7. For cancellation, confirm the exact task ID and obtain explicit approval immediately before the action.
8. Report the task ID, state transitions, artifacts, failures, and any unverified outcome.

## Safety boundaries

- Send and cancel are state-changing and require explicit approval.
- Keep tenant, audience, scope, and endpoint identity checks authoritative.
- Do not retry ordinary message-send requests automatically.
- Do not follow task-provided URLs outside the configured outbound policy.
- Bound message length, response size, operation time, monitor cycles, and artifact output.
- Redact credentials, authorization headers, query values, and secret-like task output.
- Do not claim completion unless a terminal task state or equivalent evidence was observed.

## Failure modes

Stop and report when:

- endpoint validation is absent or stale;
- approval is missing for send or cancel;
- the tenant, scope, audience, or task identity does not match;
- the destination is blocked by outbound policy;
- the task is unavailable, timed out, canceled, or returns an incompatible state;
- the operation result is ambiguous after a network interruption; or
- output cannot be bounded or safely redacted.

## Output format

Return:

- Approved operation
- Endpoint and tenant context
- Task ID and context ID
- State transition summary
- Artifact summary
- Retry or idempotency evidence
- Failure reason codes
- Remaining unknowns
- Human follow-up required
