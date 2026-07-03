import { pathToFileURL } from 'node:url';
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
      inputSchema: {
        type: 'object',
      },
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
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
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

    return {
      mode: 'mcp-bridge',
      mcpToolName: mcpTool.name,
      a2aSkillId: a2aSkill.id,
      output,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runExample()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
