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
  tenants, status). In this quickstart the registry is just an in-memory array; production
  deployments back it with `@a2amesh/registry`.
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
import { LocalCliWorkerRuntimeAdapter } from '@a2amesh/internal-worker-runtime';

const patchWorker = new LocalCliWorkerRuntimeAdapter({
  id: 'patch-worker',
  card: {
    protocolVersion: '1.0',
    name: 'Patch Worker',
    description: 'Runs a local code-mod CLI',
    url: 'local://patch-worker',
    version: '1.0.0',
  },
  command: 'my-coding-agent-cli', // must appear in policy.commandAllowlist
  buildArgs: (context) => ['run', '--task', context.task.id],
  artifactFiles: () => ['out/patch.diff', 'out/test-report.json'],
  policy: {
    commandAllowlist: ['my-coding-agent-cli'],
    envAllowlist: [], // no ambient environment variables are forwarded by default
    workspaceRoot: '/workspace/my-repo',
    timeoutMs: 5 * 60_000,
    maxConcurrentRuns: 2,
  },
});
```

Security defaults, all enforced in code (see `packages/worker-runtime/tests/LocalCliWorkerRuntimeAdapter.test.ts`
for the executable specification):

- **Command allowlist**: only `policy.commandAllowlist` entries may run; anything else returns a
  `POLICY_DENIED` failure event instead of spawning a process.
- **No secret passthrough by default**: only environment variable names listed in
  `policy.envAllowlist` are forwarded from the host process; `PATH` is always forwarded so the
  allowlisted binary can be resolved, and nothing else is implicit.
- **Workspace containment**: the resolved working directory must stay inside `policy.workspaceRoot`;
  `cwd: '../outside'` is rejected before any process starts.
- **Timeouts and cancellation**: `policy.timeoutMs` aborts a hung run with a structured `TIMEOUT`
  failure (`retryable: true`); `adapter.cancel(context, { reason })` aborts an in-flight run on
  request and reports a `canceled` event.
- **Concurrency limits**: `policy.maxConcurrentRuns` rejects new runs past the limit with a
  `POLICY_DENIED` failure rather than queuing silently.
- **Artifact capture**: `artifactFiles` declares which output files to read back after a successful
  run; each is checksummed (SHA-256) before being attached to the result.
- **Structured failures everywhere**: policy denials, spawn errors, non-zero exits, timeouts, and
  cancellations all surface as a `WorkerRuntimeResult` with a populated `failure` field — callers
  never need to catch an adapter-thrown exception to detect a failed run.

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

| Default                               | Where it is enforced                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| No secrets passed to worker processes | `LocalCliWorkerRuntimeAdapter` env allowlist                         |
| Command allowlist required            | `LocalCliWorkerRuntimeAdapter` policy check in `prepare()`/`start()` |
| Workspace containment                 | `LocalCliWorkerRuntimeAdapter.resolveCwd()`                          |
| Destructive/remote actions gated      | `FleetApprovalGate`, `FleetPolicyDecision` (see policy doc)          |
| Artifacts scanned for credentials     | `validateFleetArtifact`                                              |
| No session scraping                   | `MissionControlPlan.unsafeSessionScrapingAllowed` fixed to `false`   |
| Fail-closed routing                   | `routeFleetTask` returns no `selectedWorkerId` rather than guessing  |

## Troubleshooting

- **"command is not in the local CLI adapter allowlist"**: add the executable name to
  `policy.commandAllowlist`. The adapter never falls back to running an unlisted command.
- **"resolved working directory ... escapes workspace root"**: `cwd` (or a task-provided path) tried
  to leave `policy.workspaceRoot`. Use a path inside the workspace, or widen `workspaceRoot` if that
  is genuinely intended.
- **Run never completes / times out**: increase `policy.timeoutMs`, or check whether the wrapped CLI
  is waiting on stdin — the adapter runs with `stdio: ['ignore', 'pipe', 'pipe']`, so an agent that
  blocks on interactive input will hang until the timeout fires.
- **Environment variable the CLI needs is missing**: add its name to `policy.envAllowlist` (or pass an
  explicit value via `env`) — nothing is forwarded implicitly.
- **Declared artifact file is missing from the result**: `artifactFiles` paths are resolved relative
  to the run's working directory and silently omitted (not failed) if the file was never written or
  would resolve outside that directory; check the worker actually wrote the file before finalize.
- **`routeFleetTask` returns no `selectedWorkerId`**: read `decision.reason` — it names exactly which
  filter emptied the candidate set (capability, workspace scope, concurrency, tenant, or missing
  approval for a risk level).
