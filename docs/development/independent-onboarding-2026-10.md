# Independent A2A Mesh developer onboarding pilot — October 2026

## Purpose and boundaries

Test whether a developer who did **not** help implement A2A Mesh can start
and verify a real agent workflow in **five minutes or less**, and whether the
value beyond the official A2A SDKs is understood without coaching.

**Status (10 October 2026): No independent participants have completed the
protocol yet.** A clean temporary automated install is evidence for
installation behavior, not a human usability study. Collect only consented,
project-relevant feedback; never request tokens, private endpoints, or
screenshots containing credentials.

## Eligible independent participant

A participant is a developer unfamiliar with the implementation and without
commit access or a maintainer coaching them through the commands. Record
whether they already know TypeScript, npm/pnpm and A2A, but do not require
professional titles or personal identity. Aim for **five distinct external
developers** before drawing an onboarding conclusion.

## Task A — currently published stable 0.18.2

Use Node >=22.22.1 and a fresh empty folder, without cloning the A2A Mesh
repository. Record time from the first command until a successful build and
loopback agent startup:

```bash
pnpm dlx @a2amesh/create-a2amesh@0.18.2 my-agent --adapter custom
cd my-agent
npm install
npm run build
npm run dev
```

This tests the **published custom scaffold only**. It does not test the
new `production-demo` or `pnpm verify` feature.

## Task B — after 0.19.0 actually publishes

The following is **not available from npm at the time of this assessment**.
Only run it when all six 0.19.0 packages and the official npm release exist.
In a fresh folder:

```bash
pnpm dlx @a2amesh/create-a2amesh@0.19.0 my-demo --template production-demo
cd my-demo
pnpm install
cp .env.example .env
pnpm dev
# Separate terminal:
pnpm verify
```

Record success or failure of each verification layer, setup time, total
elapsed time, and whether the developer needed documentation beyond the
quickstart. The expected verified demo includes agent/registry health,
authenticated task completion, persisted state, bounded MCP tool invocation,
artifact output, conformance and diagnostics.

## Feedback template

- **Task/version:** A/0.18.2 or B/0.19.0.
- **Environment:** operating system, Node, npm/pnpm versions.
- **Prior experience:** TypeScript, A2A and MCP (none/basic/experienced).
- **Outcome:** completed / blocked / skipped; elapsed time; failing step.
- **Comprehension:** can you explain what A2A Mesh adds beyond an official SDK?
- **Confusing steps:** exact error text with secrets removed.
- **Would you use it?** concrete use case, objection, or missing integration.
- **Optional reproducibility:** anonymized public issue link, sanitized logs.

## Exit criteria and follow-through

Report observed human completion rates without inferring adoption from star
counts, downloads or automated clones. Fix common blockers in focused PRs.
Compare a five-minute goal against actual participants; do not call it proven
after a local automation-only pass. If there is no external participation,
record that as a missing signal rather than a successful pilot.
