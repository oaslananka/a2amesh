---
name: a2a-endpoint-validation
description: Validate an A2A endpoint, Agent Card, health route, and protocol behavior before using it in an agent workflow.
---

# A2A Endpoint Validation

Use this skill to establish bounded evidence about an A2A endpoint before sending work to it.

## When to use

Use this skill when the user asks to:

- inspect or validate an Agent Card;
- discover an A2A endpoint;
- check endpoint health or protocol conformance;
- establish whether an endpoint is suitable for a later task workflow; or
- compare declared capabilities with observed read-only behavior.

Do not treat a successful probe as proof that an endpoint is trustworthy, approved for production use, or authorized for sensitive data.

## Required context

Collect or confirm:

- the exact endpoint URL or Agent Card path;
- whether the endpoint is local, public, or on a private network;
- the expected protocol version and authentication method;
- the expected tenant or trust boundary, when applicable; and
- the permitted validation depth: metadata only, health, or conformance.

Never request concrete secret values in chat. Refer to credential variable names or an already configured runtime secret source.

## Workflow

1. Start with local CLI diagnostics: `pnpm dlx @a2amesh/cli doctor --json`.
2. Validate a file-backed Agent Card with `pnpm dlx @a2amesh/cli validate <path>` or inspect an endpoint with `discover`.
3. Run `health` before a broader conformance check.
4. Use `conformance` only against an endpoint the user is authorized to test.
5. Keep private-network access disabled unless the user explicitly authorizes the destination and `--allow-private-network` is necessary.
6. Record the endpoint, command category, observed protocol/capabilities, bounded failures, and remaining unknowns.
7. Stop before any message send, task cancellation, registry import, or other state-changing action.

## Safety boundaries

- This workflow is read-only.
- Do not bypass TLS, authentication, tenant, audience, or outbound-network policy.
- Do not infer trust from a reachable health route.
- Do not echo authorization headers, tokens, URL query credentials, or private Agent Card fields.
- Do not probe private or link-local destinations without explicit authorization.
- Treat redirects as new destinations that require the same outbound-policy checks.

## Failure modes

Stop and report a bounded diagnostic when:

- the endpoint or Agent Card is ambiguous;
- authentication is missing or rejected;
- the destination is blocked by outbound policy;
- the protocol version is incompatible;
- the response exceeds configured limits or times out; or
- the endpoint declares capabilities that cannot be verified safely.

## Output format

Return:

- Endpoint and protocol context
- Commands or checks performed
- Agent Card summary
- Health and conformance evidence
- Security or trust-boundary findings
- Failures and reason codes
- Unknowns
- Safe next action
