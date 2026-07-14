# Local Agent Mesh Quickstart

This is a runnable introduction to the Local Agent Mesh: a vendor-neutral coordination layer that
lets A2A Mesh route tasks to heterogeneous coding-agent workers (mock workers, generic local CLI
tools, or future Claude/Codex/Copilot/opencode-style adapters), collect standardized artifacts, and
keep every step auditable.

## What this is, and is not

**Is:**

- A worker adapter contract (`WorkerRuntimeContract` in `@a2amesh/internal-worker-runtime`) that any
  coding agent can implement without the core runtime knowing which vendor is behind it.
- A policy-aware router (`routeFleetTask` in `@a2amesh/internal-fleet`) that matches tasks to workers
  by capability, workspace scope, risk level, and concurrency.
- A generic local CLI adapter (`LocalCliWorkerRuntimeAdapter`) that runs an allowlisted command in a
  scoped workspace with no secret passthrough by default.
- A standardized artifact contract (`validateFleetArtifact`) for plans, diffs, patches, logs, test
  output, review comments, security findings, PR metadata, and release evidence.

**Is not:**

- A way to bypass any provider's authentication, sandboxing, or terms of service.
- An unattended merge/publish/secret-access/destructive-terminal-execution system. Every
  `remote-write`/`publish`/`deploy` side effect requires an explicit approval gate
  (`FleetApprovalGate`, `FleetPolicyDecision` — see [Policy, Sandbox, Artifact, and Approval
  Boundaries](policy-sandbox-artifacts.md)).
- A session-scraping or credential-extraction tool for any agent provider (`unsafeSessionScrapingAllowed`
  is always `false` in `MissionControlPlan`).

## Architecture at a glance

```text
FleetTask
  -> routeFleetTask()              (capability + workspace + risk + concurrency match)
  -> WorkerRuntimeContract.prepare() -> start() -> stream() -> verify() -> finalize() -> cleanup()
  -> validateFleetArtifact()        (schema, provenance, redaction)
  -> audit trail / task storage
```

- **Registry**: workers are represented as `FleetWorkerDiscoveryRecord` (capabilities, roles,
  tenants, status). The minimal demo below uses a plain in-memory array
  (`StaticWorkerDirectory`); [Registry-backed worker discovery](#registry-backed-worker-discovery)
  replaces that array with live discovery against `@a2amesh/registry`.
- **Adapter**: implements the `WorkerRuntimeContract` lifecycle
  (`packages/worker-runtime/src/types/lifecycle.ts`). Two reference implementations ship today:
  `MockWorkerRuntimeAdapter` (no process, deterministic, good for tests/demos) and
  `LocalCliWorkerRuntimeAdapter` (spawns a real allowlisted local command).
- **Task router**: `routeFleetTask` and `planFleetDispatchWaves` in
  `packages/fleet/src/routing/TaskRouter.ts`.
- **Policy**: side-effect boundaries and approval gates are modeled by `FleetPolicyDecision`,
  `FleetSandboxProfile`, and `FleetApprovalGate` in `packages/fleet/src/types/domain.ts`.
- **Artifact exchange**: `validateFleetArtifact` in `packages/fleet/src/artifact-contracts/FleetArtifacts.ts`.
- **Audit trail**: pair this with the SQLite task storage audit journal
  (`docs/packages/runtime.md#audit-journal`) when persisting task history.

## Minimal demo: two mock workers routing a task

```typescript
import { MockWorkerRuntimeAdapter } from '@a2amesh/internal-worker-runtime';
import { routeFleetTask, type FleetRoutingCandidate } from '@a2amesh/internal-fleet';

const reviewer = new MockWorkerRuntimeAdapter({
  id: 'reviewer-1',
  card: {
    protocolVersion: '1.0',
    name: 'Reviewer',
    description: 'Reviews diffs for style and correctness',
    url: 'local://reviewer-1',
    version: '1.0.0',
  },
  steps: [{ message: 'reading diff' }, { message: 'posting review comment' }],
});

const candidates: FleetRoutingCandidate[] = [
  {
    worker: {
      workerId: reviewer.id,
      card: reviewer.card,
      discoveredAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      status: 'IDLE',
      capabilities: ['code-review'],
      roles: ['reviewer'],
    },
    activeRunCount: 0,
  },
];

const decision = routeFleetTask(
  { taskId: 'task-1', requiredCapabilities: ['code-review'] },
  candidates,
  { strategy: { type: 'CAPABILITY_MATCH' }, requiredSignals: ['capability', 'availability'] },
);

if (!decision.selectedWorkerId) {
  throw new Error(`no safe agent available: ${decision.reason}`);
}

const context = {
  task: { id: 'task-1', status: { state: 'WORKING', timestamp: new Date().toISOString() } },
  worker: candidates[0].worker,
  run: { id: 'run-1', taskId: 'task-1', workerId: reviewer.id, status: 'RUNNING' as const },
};

await reviewer.prepare(context);
await reviewer.start(context);
for await (const event of reviewer.stream(context)) {
  console.log(event.type, event.message ?? '');
}
const result = await reviewer.finalize(context, {});
await reviewer.cleanup(context);
console.log('run finished with status', result.status);
```

Run the equivalent test suite directly with:

```bash
pnpm --filter @a2amesh/internal-worker-runtime run test
pnpm --filter @a2amesh/internal-fleet run test
```

## Wrapping a generic local CLI coding agent

`LocalCliWorkerRuntimeAdapter` wraps any local command-line tool as a worker. Nothing about it is
Claude/Codex/Copilot/opencode-specific — it launches whatever command you configure, inside a scoped
workspace, with no secret passthrough by default:

```typescript
import { realpathSync } from 'node:fs';
import { LocalCliWorkerRuntimeAdapter } from '@a2amesh/internal-worker-runtime';

const cliExecutable = realpathSync('/opt/tools/my-coding-agent-cli');

const patchWorker = new LocalCliWorkerRuntimeAdapter({
  id: 'patch-worker',
  card: {
    protocolVersion: '1.0',
    name: 'Patch Worker',
    description: 'Runs a local code-mod CLI',
    url: 'local://patch-worker',
    version: '1.0.0',
  },
  command: cliExecutable,
  buildArgs: (context) => ['run', '--task', context.task.id],
  artifactFiles: () => ['out/patch.diff', 'out/test-report.json'],
  policy: {
    commandAllowlist: [cliExecutable],
    envAllowlist: [], // PATH and every other ambient value are denied by default
    workspaceRoot: '/workspace/my-repo',
    timeoutMs: 5 * 60_000,
    maxConcurrentRuns: 2,
    maxArtifactFiles: 8,
    maxArtifactBytes: 5 * 1024 * 1024,
    maxTotalArtifactBytes: 10 * 1024 * 1024,
    allowedArtifactExtensions: ['.diff', '.json'],
  },
});
```

Security defaults, all enforced in code (see `packages/worker-runtime/tests/LocalCliWorkerRuntimeAdapter.test.ts`
for the executable specification):

- **Canonical executable allowlist**: `command` and every `policy.commandAllowlist` entry must be an
  absolute canonical executable path. Bare names are rejected and the adapter never searches the
  host `PATH`.
- **No secret passthrough by default**: only environment variable names listed in
  `policy.envAllowlist`, plus explicit `env` values, are forwarded. `PATH` is not implicit; supply a
  controlled value explicitly only when the child process truly needs it.
- **Canonical workspace containment**: the workspace root and working directory are resolved with
  `realpath`; lexical escapes and symlink/junction traversal are rejected before spawning.
- **Output redaction**: credential-shaped values and explicitly forwarded credential environment
  values are redacted from stdout/stderr events before they can be persisted or emitted.
- **Timeouts and cancellation**: `policy.timeoutMs` aborts a hung run with a structured `TIMEOUT`
  failure (`retryable: true`); `adapter.cancel(context, { reason })` aborts an in-flight run on
  request and reports a `canceled` event.
- **Concurrency limits**: `policy.maxConcurrentRuns` rejects new runs past the limit with a
  `POLICY_DENIED` failure rather than queuing silently.
- **Fail-closed artifact capture**: only declared, canonical, regular files inside the working
  directory are accepted. File identity is checked before and after a bounded descriptor read;
  symlinks/junctions, replacement races, devices, sockets, FIFOs, disallowed extensions, binary
  content (unless enabled), and size/count limit violations fail the run with
  `ARTIFACT_UNAVAILABLE`. Missing declared files remain optional and are omitted.
- **Structured failures everywhere**: policy denials, spawn errors, non-zero exits, timeouts,
  cancellations, and unsafe artifacts surface as a `WorkerRuntimeResult` with a populated `failure`
  field — callers never need to catch an adapter-thrown exception to detect a failed run.

Platform behavior:

- **Linux/macOS**: artifact descriptors use `O_NOFOLLOW`, inode/device identity checks, canonical path
  checks, and bounded reads.
- **Windows**: canonical path and reparse-point/junction rejection plus pre/post file identity checks
  provide the fail-closed boundary available through Node.js. Use canonical drive-qualified
  executable and workspace paths.

## A realistic workflow: issue triage to PR-ready patch

1. **Route**: `routeFleetTask` picks a worker capable of `patch-generation` for the target workspace.
2. **Plan**: the worker's first artifact is a `plan` (see artifact kinds below) describing the intended change.
3. **Implement**: the worker emits `task-update` progress events while it edits files, then returns a
   `diff` or `patch` artifact plus a `file-change-summary`.
4. **Test**: a second worker (or the same one) runs the test suite and returns `test-output` and a
   `command-log`.
5. **Review**: a reviewer worker (or a human) returns `review-comment` artifacts.
6. **Prepare the PR**: `pr-metadata` and `release-evidence` artifacts are assembled for a human to
   open the actual pull request — the mesh does not open, merge, or push PRs on its own by default;
   that is a `remote-write`/`publish` side effect gated by `FleetApprovalGate`.

`planFleetDispatchWaves` can express step 3/4's dependency (tests depend on the patch landing) as a
two-wave dispatch plan; unrelated tasks (e.g., two independent review comments) land in the same wave
and can run in parallel.

## Registry-backed worker discovery

The minimal demo above builds the candidate array by hand. `routeFleetTask`/`planFleetDispatchWaves`
never assumed that array was static — `FleetWorkerDirectory` (`packages/fleet/src/discovery/`) makes
the candidate source an explicit, swappable seam:

- `StaticWorkerDirectory` wraps a fixed array — the in-memory-list behavior above, made explicit.
- `RegistryWorkerDirectory` polls a live `@a2amesh/registry` instance instead: it queries
  `listAgents()` on a bounded refresh interval, evicts unhealthy or stale-heartbeat agents before
  they ever reach the router, and falls back to the last known-good candidate set (or a configured
  static fallback) if the registry is temporarily unreachable, so a registry outage degrades routing
  rather than breaking it.

```typescript
import { AgentRegistryClient } from '@a2amesh/runtime';
import { RegistryWorkerDirectory, routeFleetTask } from '@a2amesh/internal-fleet';

// AgentRegistryClient#listAgents() already returns the fields RegistryWorkerDirectory
// needs (id, card, status, skills, tenantId, lastHeartbeatAt) — no adapter code required.
const registry = new AgentRegistryClient('http://127.0.0.1:3099');
const directory = new RegistryWorkerDirectory(registry, {
  refreshIntervalMs: 5_000, // default; how often listAgents() is re-queried
  staleAfterMs: 60_000, // default; agents with an older heartbeat are evicted
  activeRunCounts: () => currentRunCountsByWorkerId(), // your own load tracking
});

const candidates = await directory.listCandidates();
const decision = routeFleetTask(
  { taskId: 'task-1', requiredCapabilities: ['code-review'] },
  candidates,
  { strategy: { type: 'CAPABILITY_MATCH' }, requiredSignals: ['capability', 'availability'] },
);
```

Workers publish themselves to the registry the same way any A2A agent does — call
`registry.register(agentUrl, workerCard, { tenantId })` on startup with a `WorkerCard`
(`fleetRoles`, `maxConcurrentTasks`) as the `agentCard`; no separate fleet-specific registration API
is needed. `RegistryWorkerDirectory` never dispatches to a worker the registry reports as
`unhealthy`, and `tenantScoped` routing policies are enforced the same way as with a static list,
since a registry-backed candidate carries the same `FleetWorkerDiscoveryRecord` shape.

## Artifact exchange

Every artifact a worker returns is validated with `validateFleetArtifact` before being trusted:

```typescript
import { validateFleetArtifact } from '@a2amesh/internal-fleet';

const artifact = validateFleetArtifact({
  artifactId: 'run-1:patch',
  kind: 'patch',
  taskId: 'task-1',
  contentType: 'text/x-diff',
  sensitivity: 'internal',
  redacted: false,
  provenance: { producerId: 'patch-worker', taskId: 'task-1', runId: 'run-1', branch: 'main' },
  createdAt: new Date().toISOString(),
  content: 'diff --git a/src/index.ts b/src/index.ts\n...',
});
```

Standardized kinds: `plan`, `diff`, `patch`, `file-change-summary`, `command-log`, `test-output`,
`review-comment`, `security-finding`, `pr-metadata`, `release-evidence`. Validation rejects unknown
kinds, mismatched provenance, oversized inline payloads (200 KB — use `payloadRef` for larger
artifacts), unapproved `payloadRef` schemes or embedded credentials, and any artifact whose content
looks credential-shaped (API keys, bearer tokens, private key headers) unless it is marked
`redacted: true`. `sensitivity: 'restricted'` artifacts must always be redacted before they validate.

## Security defaults (summary)

| Default                               | Where it is enforced                                                |
| ------------------------------------- | ------------------------------------------------------------------- |
| No secrets passed to worker processes | `LocalCliWorkerRuntimeAdapter` env allowlist and output redaction   |
| Canonical executable allowlist        | `resolveWorkerExecution()`; ambient PATH lookup disabled            |
| Workspace and artifact confinement    | realpath checks plus descriptor/inode validation                    |
| Destructive/remote actions gated      | `FleetApprovalGate`, `FleetPolicyDecision` (see policy doc)         |
| Artifacts scanned for credentials     | `validateFleetArtifact`                                             |
| No session scraping                   | `MissionControlPlan.unsafeSessionScrapingAllowed` fixed to `false`  |
| Fail-closed routing                   | `routeFleetTask` returns no `selectedWorkerId` rather than guessing |

## Troubleshooting

- **"command ... must be an absolute executable path"**: resolve the binary once at configuration
  time (for example `realpathSync(process.execPath)`) and use that same canonical value for `command`
  and `policy.commandAllowlist`. Bare names and PATH lookup are intentionally disabled.
- **"working directory ... escapes workspace root" / "resolves through a symbolic link"**: `cwd`
  tried to leave the canonical workspace or traverse a symlink/junction. Use a real directory inside
  `policy.workspaceRoot`; do not widen the root merely to accommodate an untrusted link.
- **Run never completes / times out**: increase `policy.timeoutMs`, or check whether the wrapped CLI
  is waiting on stdin — the adapter runs with `stdio: ['ignore', 'pipe', 'pipe']`, so an agent that
  blocks on interactive input will hang until the timeout fires.
- **Environment variable the CLI needs is missing**: add its name to `policy.envAllowlist` (or pass an
  explicit value via `env`) — nothing is forwarded implicitly.
- **Declared artifact file is missing from the result**: a file that was never produced is optional
  and omitted. An existing path that escapes confinement, traverses a link/junction, is not a regular
  file, changes during capture, violates extension/content policy, or exceeds a limit fails closed
  with `ARTIFACT_UNAVAILABLE`; inspect the final failure event.
- **`routeFleetTask` returns no `selectedWorkerId`**: read `decision.reason` — it names exactly which
  filter emptied the candidate set (capability, workspace scope, concurrency, tenant, or missing
  approval for a risk level).
