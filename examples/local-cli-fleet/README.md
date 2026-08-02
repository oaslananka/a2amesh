# Local CLI Fleet Example (Experimental)

**Status: experimental/alpha.** This demonstrates a pattern - wrapping a generic local
CLI coding agent as an A2A Mesh Fleet worker - not a finished or supported integration
with any specific CLI. It depends on internal (unpublished) `@a2amesh/internal-fleet`,
`@a2amesh/internal-worker-runtime`, and `@a2amesh/internal-worker-cli` packages, so unlike
the other examples in this directory it only runs inside this monorepo and is not meant
to be copied standalone into another project.

It builds a `WorkerCard` and a `FleetProviderWorkerPlan` for a "local CLI coding agent"
worker role, routes a sample task to it with `routeFleetTask`, and executes the task
through `OfficialCliWorkerRuntimeAdapter`, which validates a task-bound Fleet admission
before delegating to `LocalCliWorkerRuntimeAdapter` and capturing a declared output file
as a checksummed artifact. The default/tested path never runs an external CLI: it invokes a
canonical `process.execPath` Node.js stand-in command, so this example never depends on any external binary
or provider credentials being present.

## Run

```bash
pnpm --dir examples/local-cli-fleet run start
```

PowerShell:

```powershell
pnpm --dir examples/local-cli-fleet run start
```

## Run the smoke test

```bash
pnpm --dir examples/local-cli-fleet run smoke
```

PowerShell:

```powershell
pnpm --dir examples/local-cli-fleet run smoke
```

## Using a real coding CLI

The adapter and routing code are generic; only the command changes:

- Set `A2AMESH_CLI_FLEET_COMMAND` to the **absolute executable path** of the CLI you
  want to run (for example `/opt/tools/my-agent/bin/agent` or a canonical Windows
  path). Bare command names are rejected; the adapter never searches the host `PATH`.
- Leave `A2AMESH_CLI_FLEET_API_KEY_ENV` unset when the official CLI owns its authenticated
  local session (`credentialPolicy: 'official-cli-session'`). Set it only to the _name_ of
  an environment variable already managed outside the repository when the CLI requires an
  environment credential (`credentialPolicy: 'env-ref'`). The example forwards only that
  named reference to the allowlisted process and never accepts an inline value.
- Replace `buildArgs` in `src/index.ts` with the argument shape your CLI expects.

For live worker discovery instead of the in-process `StaticWorkerDirectory` used here,
see `@a2amesh/internal-fleet`'s `RegistryWorkerDirectory`, and `examples/agent-mesh` for
a worked registry-discovery example.

## Files

- `src/index.ts` builds the worker card, provider plan, and explicit local-write approval,
  routes a task with `routeFleetTask`, and runs it through `OfficialCliWorkerRuntimeAdapter`.
- `tests/smoke.test.ts` verifies routing succeeds and the run completes with a
  checksummed artifact, using only the canonical Node.js stand-in executable.
- `.env.example` documents the optional env-ref knobs for pointing this at a real CLI.
