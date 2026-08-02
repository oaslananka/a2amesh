import { pathToFileURL } from 'node:url';
import type {
  FleetProviderWorkerPlan,
  FleetWorkerRunAdmission,
  WorkerCard,
} from '@a2amesh/internal-fleet';
import { McpWorkerRuntimeAdapter } from '@a2amesh/internal-worker-mcp';
import type { WorkerRuntimeContext } from '@a2amesh/internal-worker-runtime';
import {
  createA2ASkillFromMcpTool,
  createMcpToolFromAgent,
  handleA2AMcpToolCall,
} from '@a2amesh/mcp';

export interface McpBridgeExampleResult {
  mode: 'mcp-bridge';
  mcpToolName: string;
  a2aSkillId: string;
  output: string;
  workerRunStatus: string;
  workerArtifactChecksum?: string;
}

const workerCard: WorkerCard = {
  protocolVersion: '1.0',
  name: 'mcp-repository-reader',
  description: 'Reads repository context through one documented MCP tool.',
  url: 'mcp://repository-reader',
  version: '1.0.0',
  fleetRoles: ['research-worker'],
};

const providerPlan: FleetProviderWorkerPlan = {
  providerId: 'example-mcp-server',
  workerRole: 'research-worker',
  supportStatus: 'experimental',
  allowedSurfaces: ['mcp-server', 'artifact-handoff'],
  forbiddenSurfaces: [
    'browser-session',
    'web-ui-scraping',
    'private-endpoint',
    'token-extraction',
    'subscription-bypass',
  ],
  capabilities: ['repository-read'],
  credentialPolicy: 'none',
};

function readOnlyAdmission(): FleetWorkerRunAdmission {
  return {
    taskId: 'task-mcp-worker-example',
    workerId: 'mcp-repository-reader',
    decision: {
      allowed: true,
      sideEffectLevel: 'read-only',
      sandbox: {
        isolation: 'process',
        network: 'disabled',
        filesystem: 'read-only',
      },
      artifactPolicy: {
        sensitivity: 'internal',
        allowedArtifactTypes: ['text'],
        requireChecksum: true,
        requireRedaction: true,
      },
      approval: { requiredFor: [], state: 'NOT_REQUIRED' },
      evidence: ['example:read-only'],
    },
    boundaries: [
      {
        level: 'read-only',
        requiresApproval: false,
        requiresAudit: true,
      },
    ],
  };
}

async function runMcpWorker(): Promise<{
  status: string;
  checksum?: string;
}> {
  const adapter = new McpWorkerRuntimeAdapter({
    id: 'mcp-repository-reader',
    card: workerCard,
    providerPlan,
    client: {
      callTool: async ({ name, arguments: args }) => ({
        content: [
          {
            type: 'text',
            text: `${name}:${String(args?.['prompt'] ?? '')}`,
          },
        ],
      }),
    },
    toolName: 'repo.read',
    buildArguments: (context) => ({ prompt: context.task.description }),
    resolveAdmission: () => readOnlyAdmission(),
    policy: {
      allowedTools: ['repo.read'],
      timeoutMs: 5_000,
      maxConcurrentRuns: 1,
      maxOutputCharacters: 10_000,
    },
  });
  const now = new Date().toISOString();
  const context: WorkerRuntimeContext = {
    task: {
      id: 'task-mcp-worker-example',
      description: 'summarize bridge mapping',
      status: { state: 'WORKING', timestamp: now },
      createdAt: now,
      updatedAt: now,
    },
    worker: {
      id: 'mcp-repository-reader',
      card: workerCard,
      status: 'IDLE',
      lastSeenAt: now,
    },
    run: {
      id: 'run-mcp-worker-example',
      taskId: 'task-mcp-worker-example',
      workerId: 'mcp-repository-reader',
      status: 'RUNNING',
    },
    metadata: { sideEffectLevel: 'read-only', mcpToolName: 'repo.read' },
  };

  await adapter.start(context);
  for await (const event of adapter.stream(context)) {
    if (event.type === 'failed' || event.type === 'canceled' || event.type === 'finalized') break;
  }
  const result = await adapter.finalize(context, { status: 'RUNNING' });
  const verification = await adapter.verify(context);
  if (result.status !== 'COMPLETED' || verification.status !== 'PASSED') {
    throw new Error('MCP worker example did not complete verification.');
  }
  const checksum = result.artifacts?.[0]?.metadata?.['checksumSha256'];
  return {
    status: result.status,
    ...(typeof checksum === 'string' ? { checksum } : {}),
  };
}

export async function runExample(): Promise<McpBridgeExampleResult> {
  const agentUrl = process.env['MCP_BRIDGE_AGENT_URL'] ?? 'http://localhost:3001';
  const mcpTool = createMcpToolFromAgent({
    agentUrl,
    name: 'Research Agent',
    description: 'Answers local smoke-test prompts.',
  });
  const a2aSkill = createA2ASkillFromMcpTool(
    {
      name: 'calculator',
      description: 'Adds local numbers.',
      inputSchema: { type: 'object' },
    },
    { tags: ['math'] },
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'mcp-example',
        result: {
          id: 'task-mcp-example',
          status: { state: 'COMPLETED', timestamp: new Date().toISOString() },
          history: [],
          artifacts: [
            {
              artifactId: 'mcp-output',
              parts: [{ type: 'text', text: 'mcp bridge response' }],
              index: 0,
              lastChunk: true,
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  try {
    const result = await handleA2AMcpToolCall(
      {
        agentUrl,
        name: 'Research Agent',
        description: 'Answers local smoke-test prompts.',
        security: {
          requestId: 'mcp-example',
          tenantId: 'example-tenant',
          expectedTenantId: 'example-tenant',
          authContext: {
            subject: 'example-operator',
            audience: 'urn:mcp:a2a-bridge',
            scopes: ['mcp:tools'],
          },
          audiencePolicy: { expectedAudience: 'urn:mcp:a2a-bridge' },
          requiredScopes: ['mcp:tools'],
          consent: { decision: 'approved', approvalId: 'example-approval' },
          outboundPolicy: { allowLocalhost: true },
        },
      },
      { message: 'summarize bridge mapping' },
    );
    const firstContent = result.content[0];
    const output =
      firstContent && firstContent.type === 'text' ? firstContent.text : 'missing text output';
    const worker = await runMcpWorker();

    return {
      mode: 'mcp-bridge',
      mcpToolName: mcpTool.name,
      a2aSkillId: a2aSkill.id,
      output,
      workerRunStatus: worker.status,
      ...(worker.checksum ? { workerArtifactChecksum: worker.checksum } : {}),
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function formatExampleFailure(_error: unknown): string {
  return 'MCP bridge example failed. Review configuration and policy.';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = await runExample();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    process.stderr.write(`${formatExampleFailure(error)}\n`);
    process.exitCode = 1;
  }
}
