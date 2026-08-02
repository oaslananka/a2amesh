# @a2amesh/internal-worker-cli

Experimental policy-backed Fleet worker for documented official command-line interfaces.

The package layers `FleetProviderWorkerPlan` and `FleetWorkerRunAdmission` checks over the provider-neutral `LocalCliWorkerRuntimeAdapter`. It does not implement a shell, discover executables through `PATH`, extract local CLI sessions, or add provider-specific browser automation.

## Security boundary

The worker:

- requires an absolute executable that is present in both the runtime allowlist and the per-run Fleet sandbox decision;
- requires `official-cli` and `artifact-handoff` provider surfaces;
- requires browser sessions, web scraping, private endpoints, token extraction, and subscription bypass to remain forbidden;
- accepts credential references by environment-variable **name** only, or uses an existing official CLI session without forwarding environment references;
- delegates path confinement, output redaction, timeout, cancellation, concurrency, and checksummed artifact capture to `LocalCliWorkerRuntimeAdapter`;
- permits `read-only` work and approval-backed `local-write` worktree mutation;
- denies `remote-write`, `publish`, and `deploy` side effects even when an approval object is present.

The `resolveAdmission` callback must return the current task/worker-bound `FleetWorkerRunAdmission`. Local repository mutation requires an `APPROVED` gate, an approver, an audited `local-write` boundary, `workspace-write` filesystem policy, the exact command in `allowedCommands`, and the `git-worktree` provider surface.

## Example

```ts
import { realpathSync } from 'node:fs';
import { OfficialCliWorkerRuntimeAdapter } from '@a2amesh/internal-worker-cli';

const command = realpathSync('/opt/vendor/bin/documented-cli');

const worker = new OfficialCliWorkerRuntimeAdapter({
  id: 'official-cli-worker',
  card,
  providerPlan: {
    providerId: 'documented-cli',
    workerRole: 'code-worker',
    supportStatus: 'experimental',
    allowedSurfaces: ['official-cli', 'git-worktree', 'artifact-handoff'],
    forbiddenSurfaces: [
      'browser-session',
      'web-ui-scraping',
      'private-endpoint',
      'token-extraction',
      'subscription-bypass',
    ],
    capabilities: ['patch-generation'],
    credentialPolicy: 'official-cli-session',
  },
  command,
  buildArgs: (context) => ['run', '--task', context.task.id],
  artifactFiles: () => ['out/patch.diff', 'out/test-report.json'],
  resolveAdmission: async (context) => approvalStore.requireAdmission(context),
  policy: {
    commandAllowlist: [command],
    workspaceRoot: '/workspace/repository',
    timeoutMs: 5 * 60_000,
    maxConcurrentRuns: 1,
  },
});
```

The caller owns the official CLI installation, authentication lifecycle, sandbox enforcement outside the process, and approval-store implementation. Secret values must come from the deployment secret manager and must not be placed in worker cards, task metadata, artifacts, logs, or repository files.

## Validation

```bash
pnpm --filter @a2amesh/internal-worker-cli run build
pnpm --filter @a2amesh/internal-worker-cli run typecheck
pnpm --filter @a2amesh/internal-worker-cli run test
pnpm --filter @a2amesh/runtime-example-local-cli-fleet run smoke
```
