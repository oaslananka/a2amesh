# Agent Mesh Example

This example starts a local registry and two independent A2A agents (a Researcher and a Summarizer). An orchestrator discovers both agents through the registry — no hardcoded agent URLs — then pipelines a real `message/send` call from one agent's output into the other's input.

## Run

```bash
pnpm --dir examples/agent-mesh run start
```

PowerShell:

```powershell
pnpm --dir examples/agent-mesh run start
```

## Run the smoke test

```bash
pnpm --dir examples/agent-mesh run smoke
```

PowerShell:

```powershell
pnpm --dir examples/agent-mesh run smoke
```

## Files

- `src/index.ts` starts the registry and both agents, discovers them by advertised skill, and hands the Researcher's output to the Summarizer.
- `tests/smoke.test.ts` verifies discovery and the two-step task hand-off.
- `.env.example` documents the local registry token and optional port.
