# @a2amesh/internal-worker-mcp

Experimental private Fleet worker for documented MCP tool integrations.

The adapter accepts an MCP client created and authenticated by the caller. It does not own transport discovery, extract credentials, inspect browser sessions, or call undocumented endpoints.

## Guarantees

- requires a `FleetProviderWorkerPlan` with `mcp-server` and `artifact-handoff` surfaces;
- invokes one explicitly configured tool from a bounded allowlist;
- binds every call to the current task, worker, requested tool, and Fleet admission;
- permits `read-only` work and approval-gated `local-write` worktree mutation;
- denies `remote-write`, `publish`, and `deploy` side effects;
- enforces timeout, cancellation, concurrency, output-size, audit, checksum, and redaction policy;
- converts bounded text tool output into a SHA-256 checksummed artifact;
- returns credential-safe failure messages without echoing tool output or provider errors.

## Usage

```ts
import { McpWorkerRuntimeAdapter } from '@a2amesh/internal-worker-mcp';

const worker = new McpWorkerRuntimeAdapter({
  id: 'repo-reader',
  card,
  providerPlan,
  client: documentedMcpClient,
  toolName: 'repo.read',
  buildArguments: (context) => ({ prompt: context.task.description }),
  resolveAdmission: (context) => approvalStore.resolve(context),
  policy: {
    allowedTools: ['repo.read'],
    timeoutMs: 30_000,
    maxConcurrentRuns: 1,
    maxOutputCharacters: 100_000,
  },
});
```

The caller owns MCP transport configuration, authentication, server identity validation, and approval persistence. Credential values must come from the deployment secret manager and must not be placed in worker cards, task metadata, artifacts, logs, or repository files.

## Validation

```bash
pnpm --filter @a2amesh/internal-worker-mcp run build
pnpm --filter @a2amesh/internal-worker-mcp run typecheck
pnpm --filter @a2amesh/internal-worker-mcp run test
```
