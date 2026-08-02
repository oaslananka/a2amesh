import { describe, expect, it, vi } from 'vitest';
import type {
  FleetProviderWorkerPlan,
  FleetSideEffectLevel,
  FleetWorkerRunAdmission,
  WorkerCard,
} from '@a2amesh/internal-fleet';
import type { WorkerRuntimeContext, WorkerRuntimeEvent } from '@a2amesh/internal-worker-runtime';
import {
  McpWorkerRuntimeAdapter,
  type McpToolCallRequest,
  type McpWorkerClient,
} from '../src/index.js';

const card: WorkerCard = {
  protocolVersion: '1.0',
  name: 'mcp-worker',
  description: 'Policy-backed MCP Fleet worker.',
  url: 'mcp://mcp-worker',
  version: '1.0.0',
  fleetRoles: ['research-worker'],
};

const providerPlan: FleetProviderWorkerPlan = {
  providerId: 'documented-mcp-server',
  workerRole: 'research-worker',
  supportStatus: 'experimental',
  allowedSurfaces: ['mcp-server', 'artifact-handoff', 'git-worktree'],
  forbiddenSurfaces: [
    'browser-session',
    'web-ui-scraping',
    'private-endpoint',
    'token-extraction',
    'subscription-bypass',
  ],
  capabilities: ['research', 'patch-generation'],
  credentialPolicy: 'secret-manager-ref',
};

function context(runId = 'run-1'): WorkerRuntimeContext {
  const now = '2026-08-02T00:00:00.000Z';
  return {
    task: {
      id: 'task-1',
      description: 'Summarize the repository policy.',
      status: { state: 'WORKING', timestamp: now },
      createdAt: now,
      updatedAt: now,
    },
    worker: { id: 'mcp-worker', card, status: 'IDLE', lastSeenAt: now },
    run: { id: runId, taskId: 'task-1', workerId: 'mcp-worker', status: 'RUNNING' },
    metadata: { sideEffectLevel: 'read-only', mcpToolName: 'repo.read' },
  };
}

function admission(
  sideEffectLevel: FleetSideEffectLevel,
  state: FleetWorkerRunAdmission['decision']['approval']['state'],
): FleetWorkerRunAdmission {
  const write = sideEffectLevel !== 'read-only';
  return {
    taskId: 'task-1',
    workerId: 'mcp-worker',
    decision: {
      allowed: true,
      sideEffectLevel,
      sandbox: {
        isolation: 'process',
        network: 'allowlisted',
        filesystem: write ? 'workspace-write' : 'read-only',
      },
      artifactPolicy: {
        sensitivity: 'internal',
        allowedArtifactTypes: ['text', 'json', 'patch'],
        requireChecksum: true,
        requireRedaction: true,
      },
      approval: {
        requiredFor: write ? [sideEffectLevel] : [],
        state,
        ...(state === 'APPROVED' ? { approver: 'maintainer' } : {}),
      },
      evidence: ['policy:test'],
    },
    boundaries: [
      {
        level: sideEffectLevel,
        requiresApproval: write,
        requiresAudit: true,
      },
    ],
  };
}

function client(
  callTool: McpWorkerClient['callTool'] = vi.fn(async () => ({
    content: [{ type: 'text', text: 'safe MCP response' }],
  })),
): McpWorkerClient {
  return { callTool };
}

function adapter(
  overrides: Partial<ConstructorParameters<typeof McpWorkerRuntimeAdapter>[0]> = {},
): McpWorkerRuntimeAdapter {
  return new McpWorkerRuntimeAdapter({
    id: 'mcp-worker',
    card,
    providerPlan,
    client: client(),
    toolName: 'repo.read',
    buildArguments: (ctx) => ({ taskId: ctx.task.id, prompt: ctx.task.description }),
    resolveAdmission: () => admission('read-only', 'NOT_REQUIRED'),
    policy: {
      allowedTools: ['repo.read'],
      timeoutMs: 5_000,
      maxConcurrentRuns: 1,
      maxOutputCharacters: 10_000,
    },
    ...overrides,
  });
}

async function collect(stream: AsyncIterable<WorkerRuntimeEvent>): Promise<WorkerRuntimeEvent[]> {
  const events: WorkerRuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('McpWorkerRuntimeAdapter', () => {
  it('requires the documented MCP server and artifact handoff surfaces', () => {
    expect(() =>
      adapter({ providerPlan: { ...providerPlan, allowedSurfaces: ['artifact-handoff'] } }),
    ).toThrow(/mcp-server/i);
    expect(() =>
      adapter({ providerPlan: { ...providerPlan, allowedSurfaces: ['mcp-server'] } }),
    ).toThrow(/artifact-handoff/i);
  });

  it('requires all unsafe provider surfaces to remain forbidden', () => {
    expect(() =>
      adapter({ providerPlan: { ...providerPlan, forbiddenSurfaces: ['browser-session'] } }),
    ).toThrow(/forbidden/i);
  });

  it('rejects unsupported plans and official CLI session credentials', () => {
    expect(() =>
      adapter({ providerPlan: { ...providerPlan, supportStatus: 'unsupported' } }),
    ).toThrow(/supported or experimental/i);
    expect(() =>
      adapter({ providerPlan: { ...providerPlan, credentialPolicy: 'official-cli-session' } }),
    ).toThrow(/credential/i);
  });

  it('requires a valid allowlisted tool name', () => {
    expect(() => adapter({ toolName: 'repo.delete' })).toThrow(/allowlist/i);
    expect(() =>
      adapter({ toolName: 'bad tool name', policy: { allowedTools: ['bad tool name'] } }),
    ).toThrow(/tool name/i);
  });

  it('runs an admitted read-only tool and verifies a checksummed artifact', async () => {
    const callTool = vi.fn(async (request: McpToolCallRequest) => ({
      content: [{ type: 'text' as const, text: `result:${String(request.arguments?.['taskId'])}` }],
    }));
    const worker = adapter({ client: client(callTool) });
    const ctx = context();

    expect((await worker.prepare(ctx)).type).toBe('prepared');
    expect((await worker.start(ctx)).type).toBe('started');
    const events = await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });
    const verification = await worker.verify(ctx);

    expect(callTool).toHaveBeenCalledWith(
      { name: 'repo.read', arguments: { taskId: 'task-1', prompt: ctx.task.description } },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(events.at(-1)?.type).toBe('finalized');
    expect(result.status).toBe('COMPLETED');
    expect(result.artifacts?.[0]?.metadata?.['checksumSha256']).toMatch(/^[a-f0-9]{64}$/u);
    expect(verification.status).toBe('PASSED');
  });

  it('requires explicit approval for local-write worktree mutations', async () => {
    const worker = adapter({ resolveAdmission: () => admission('local-write', 'PENDING') });
    const ctx = context();
    ctx.metadata = { sideEffectLevel: 'local-write', mcpToolName: 'repo.read' };

    const event = await worker.prepare(ctx);
    expect(event).toMatchObject({ type: 'failed', failure: { code: 'POLICY_DENIED' } });
    expect(event.failure?.message).toMatch(/approval/i);
  });

  it('allows approved local-write MCP work', async () => {
    const worker = adapter({ resolveAdmission: () => admission('local-write', 'APPROVED') });
    const ctx = context('local-write');
    ctx.metadata = { sideEffectLevel: 'local-write', mcpToolName: 'repo.read' };

    expect((await worker.prepare(ctx)).type).toBe('prepared');
    await worker.start(ctx);
    await collect(worker.stream(ctx));
    expect((await worker.finalize(ctx, { status: 'RUNNING' })).status).toBe('COMPLETED');
  });

  it.each(['remote-write', 'publish', 'deploy'] as const)(
    'denies %s side effects even when approved',
    async (level) => {
      const worker = adapter({ resolveAdmission: () => admission(level, 'APPROVED') });
      const ctx = context(level);
      ctx.metadata = { sideEffectLevel: level, mcpToolName: 'repo.read' };
      const event = await worker.prepare(ctx);
      expect(event.failure?.message).toContain(level);
    },
  );

  it('binds admission to the task, worker, requested tool, and side-effect level', async () => {
    const wrongTask = admission('read-only', 'NOT_REQUIRED');
    wrongTask.taskId = 'other-task';
    expect(
      (await adapter({ resolveAdmission: () => wrongTask }).prepare(context())).failure?.message,
    ).toMatch(/task/i);

    const wrongToolContext = context('wrong-tool');
    wrongToolContext.metadata = { sideEffectLevel: 'read-only', mcpToolName: 'other.tool' };
    expect((await adapter().prepare(wrongToolContext)).failure?.message).toMatch(/tool/i);

    const wrongLevelContext = context('wrong-level');
    wrongLevelContext.metadata = { sideEffectLevel: 'local-write', mcpToolName: 'repo.read' };
    expect((await adapter().prepare(wrongLevelContext)).failure?.message).toMatch(/side-effect/i);
  });

  it('fails closed when admission resolution throws', async () => {
    const worker = adapter({
      resolveAdmission: () => Promise.reject(new Error('secret admission data')),
    });
    const event = await worker.prepare(context());
    expect(event.failure?.message).toBe('Fleet admission resolution failed closed.');
    expect(JSON.stringify(event)).not.toContain('secret admission data');
  });

  it('rejects missing isolation and missing artifact controls', async () => {
    const unisolated = admission('read-only', 'NOT_REQUIRED');
    unisolated.decision.sandbox.isolation = 'none';
    expect(
      (await adapter({ resolveAdmission: () => unisolated }).prepare(context())).failure?.message,
    ).toMatch(/isolation/i);

    const unchecked = admission('read-only', 'NOT_REQUIRED');
    unchecked.decision.artifactPolicy.requireChecksum = false;
    expect(
      (await adapter({ resolveAdmission: () => unchecked }).prepare(context())).failure?.message,
    ).toMatch(/checksum/i);
  });

  it('fails closed for incomplete audit, approval, and artifact boundaries', async () => {
    const missingBoundary = admission('read-only', 'NOT_REQUIRED');
    missingBoundary.boundaries = [];
    expect(
      (
        await adapter({ resolveAdmission: () => missingBoundary }).prepare(
          context('missing-boundary'),
        )
      ).failure?.message,
    ).toMatch(/boundary/i);

    const unaudited = admission('read-only', 'NOT_REQUIRED');
    unaudited.boundaries = [{ ...unaudited.boundaries[0]!, requiresAudit: false }];
    expect(
      (await adapter({ resolveAdmission: () => unaudited }).prepare(context('unaudited'))).failure
        ?.message,
    ).toMatch(/audit/i);

    const gatedRead = admission('read-only', 'PENDING');
    gatedRead.decision.approval.requiredFor = ['read-only'];
    expect(
      (await adapter({ resolveAdmission: () => gatedRead }).prepare(context('gated-read'))).failure
        ?.message,
    ).toMatch(/approval-gated/i);

    const expired = admission('read-only', 'NOT_REQUIRED');
    expired.decision.approval.expiresAt = '2020-01-01T00:00:00.000Z';
    expect(
      (await adapter({ resolveAdmission: () => expired }).prepare(context('expired'))).failure
        ?.message,
    ).toMatch(/expired/i);

    const unredacted = admission('read-only', 'NOT_REQUIRED');
    unredacted.decision.artifactPolicy.requireRedaction = false;
    expect(
      (await adapter({ resolveAdmission: () => unredacted }).prepare(context('unredacted'))).failure
        ?.message,
    ).toMatch(/redaction/i);
  });

  it('classifies ordinary MCP client rejection without exposing provider details', async () => {
    const worker = adapter({
      client: client(async () => {
        throw new Error('provider-secret-value');
      }),
    });
    const ctx = context('client-rejection');
    await worker.start(ctx);
    await collect(worker.stream(ctx));
    const result = await worker.finalize(ctx, { status: 'RUNNING' });

    expect(result.failure).toMatchObject({ code: 'UNKNOWN', retryable: false });
    expect(JSON.stringify(result)).not.toContain('provider-secret-value');
  });

  it('fails safely when the MCP tool reports an error or no text output', async () => {
    const secret = 'provider-secret-value';
    const errored = adapter({
      client: client(async () => ({ content: [{ type: 'text', text: secret }], isError: true })),
    });
    const errorContext = context('tool-error');
    await errored.start(errorContext);
    await collect(errored.stream(errorContext));
    const errorResult = await errored.finalize(errorContext, { status: 'RUNNING' });
    expect(errorResult.status).toBe('FAILED');
    expect(JSON.stringify(errorResult)).not.toContain(secret);

    const empty = adapter({
      client: client(async () => ({ content: [{ type: 'image', data: 'x' }] })),
    });
    const emptyContext = context('empty');
    await empty.start(emptyContext);
    await collect(empty.stream(emptyContext));
    expect((await empty.finalize(emptyContext, { status: 'RUNNING' })).status).toBe('FAILED');
  });

  it('enforces output boundaries', async () => {
    const worker = adapter({
      client: client(async () => ({ content: [{ type: 'text', text: 'too-long' }] })),
      policy: { allowedTools: ['repo.read'], maxOutputCharacters: 4 },
    });
    const ctx = context('bounded');
    await worker.start(ctx);
    await collect(worker.stream(ctx));
    expect((await worker.finalize(ctx, { status: 'RUNNING' })).status).toBe('FAILED');
  });

  it('times out and cancels in-flight MCP calls', async () => {
    const hangingClient = client(
      (_request, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    const timed = adapter({
      client: hangingClient,
      policy: { allowedTools: ['repo.read'], timeoutMs: 20 },
    });
    const timeoutContext = context('timeout');
    await timed.start(timeoutContext);
    await collect(timed.stream(timeoutContext));
    expect((await timed.finalize(timeoutContext, { status: 'RUNNING' })).failure?.code).toBe(
      'TIMEOUT',
    );

    const canceled = adapter({ client: hangingClient });
    const cancelContext = context('cancel');
    await canceled.start(cancelContext);
    await canceled.cancel(cancelContext, {
      requestedAt: new Date().toISOString(),
      requestedBy: 'operator',
      reason: 'operator canceled',
    });
    await collect(canceled.stream(cancelContext));
    expect((await canceled.finalize(cancelContext, { status: 'RUNNING' })).status).toBe('CANCELED');
  });

  it('enforces concurrency and supports cleanup', async () => {
    let release: (() => void) | undefined;
    const waiting = client(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ content: [{ type: 'text', text: 'done' }] });
        }),
    );
    const worker = adapter({ client: waiting });
    const first = context('first');
    const second = context('second');

    expect((await worker.start(first)).type).toBe('started');
    expect((await worker.start(second)).failure?.code).toBe('WORKER_UNAVAILABLE');
    release?.();
    await collect(worker.stream(first));
    expect((await worker.cleanup(first)).type).toBe('cleaned-up');
  });

  it('keeps duplicate starts idempotent and rejects run-id rebinding', async () => {
    const worker = adapter();
    const ctx = context('duplicate');
    const first = await worker.start(ctx);
    const second = await worker.start(ctx);
    expect(second).toEqual(first);
    await collect(worker.stream(ctx));

    const rebound = context('duplicate');
    rebound.task.id = 'other-task';
    rebound.run.taskId = 'other-task';
    expect((await worker.start(rebound)).failure?.message).toMatch(/different task or worker/i);
  });
});
