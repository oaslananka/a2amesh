import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMcpToolFromAgent, handleA2AMcpToolCall } from '../src/A2ATool.js';
import { createA2ASkillFromMcpTool } from '../src/McpToolSkill.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

describe('A2A to MCP Tool Bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates an MCP Tool schema from an A2A Agent configuration', () => {
    const tool = createMcpToolFromAgent({
      agentUrl: 'http://localhost:3001',
      name: 'Researcher Agent',
      description: 'Finds information on the internet.',
    });

    expect(tool.name).toBe('researcher-agent');
    expect(tool.description).toContain('[A2A Agent Proxy]');
    expect(tool.inputSchema.required).toContain('message');
  });

  it('forwards the tool call to the A2A Agent and maps output', async () => {
    // Mock the global fetch to return a completed task structure
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          result: {
            id: 'task-1',
            status: { state: 'COMPLETED' },
            artifacts: [{ parts: [{ type: 'text', text: 'This is the research data.' }] }],
          },
        }),
      ),
    );

    const result = await handleA2AMcpToolCall(
      { agentUrl: 'http://localhost:3001', name: 'Researcher', description: 'test' },
      { message: 'What is A2A?' },
    );
    const firstContent = result.content[0];

    expect(result.isError).toBe(false);
    expect(firstContent).toBeDefined();
    expect(firstContent?.type).toBe('text');
    if (!firstContent || firstContent.type !== 'text') {
      throw new Error('Expected a text content item');
    }
    expect(firstContent.text).toBe('This is the research data.');
  });
});

describe('MCP to A2A Skill Bridge', () => {
  it('maps an MCP Tool to an A2A Skill', () => {
    const mcpTool: Tool = {
      name: 'calculator',
      description: 'Adds two numbers',
      inputSchema: { type: 'object' },
    };

    const skill = createA2ASkillFromMcpTool(mcpTool, { tags: ['math'] });

    expect(skill.id).toBe('mcp-calculator');
    expect(skill.name).toBe('calculator');
    expect(skill.description).toContain('[MCP Tool]');
    expect(skill.tags).toContain('math');
    expect(skill.tags).toContain('mcp');
  });
});

describe('MCP audit and approval helpers', () => {
  it('blocks tools outside an allow list', async () => {
    const { decideMcpToolApproval } = await import('../src/McpAudit.js');
    const tool: Tool = {
      name: 'shell-runner',
      description: 'Runs shell commands',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
    };

    const result = decideMcpToolApproval(tool, { allowedTools: ['calculator'] });

    expect(result.decision).toBe('block');
    expect(result.findings.map((finding) => finding.id)).toContain('tool-not-allowed');
  });

  it('marks approval-required tools for review', async () => {
    const { decideMcpToolApproval } = await import('../src/McpAudit.js');
    const tool: Tool = {
      name: 'browser',
      description: 'Uses a browser to inspect a page',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    };

    const result = decideMcpToolApproval(tool, { approvalRequiredTools: ['browser'] });

    expect(result.decision).toBe('review');
    expect(result.risk).toBe('medium');
  });

  it('builds an allowed tool list from audit decisions', async () => {
    const { createAllowedMcpTools } = await import('../src/McpAudit.js');
    const tools: Tool[] = [
      {
        name: 'calculator',
        description: 'Adds numbers',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'exporter',
        description: 'Exports records',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    expect(createAllowedMcpTools(tools, { blockedTools: ['exporter'] })).toEqual(['calculator']);
  });
});

describe('MCP auth boundary helpers', () => {
  it('rejects credentials scoped to another MCP-facing resource', async () => {
    const { validateMcpAudience } = await import('../src/McpAuthBoundary.js');

    const result = validateMcpAudience(
      {
        issuer: 'https://issuer.example.com',
        subjectClass: 'service-account',
        audience: 'urn:mcp:registry',
        clientId: 'internal-api-client',
        scopes: ['agents:read'],
        tokenSource: 'authorization-header',
      },
      { expectedAudience: 'urn:mcp:runtime' },
    );

    expect(result.decision).toBe('block');
    expect(result.reasonCode).toBe('mcp-audience-mismatch');
    expect(result.evidencePointers).toEqual(['claims.audience', 'policy.expectedAudience']);
  });

  it('rejects ambiguous multi-audience credentials without an explicit MCP resource', async () => {
    const { validateMcpAudience } = await import('../src/McpAuthBoundary.js');

    const result = validateMcpAudience(
      {
        issuer: 'https://issuer.example.com',
        audience: ['urn:mcp:runtime', 'urn:mcp:registry'],
        clientId: 'mesh-client',
        scopes: ['mcp:tools'],
        tokenSource: 'authorization-header',
      },
      { expectedAudience: ['urn:mcp:runtime', 'urn:mcp:registry'] },
    );

    expect(result.decision).toBe('block');
    expect(result.reasonCode).toBe('mcp-audience-ambiguous');
    expect(result.matchedAudiences).toEqual(['urn:mcp:runtime', 'urn:mcp:registry']);
  });

  it('accepts multi-audience credentials when the intended MCP resource is selected', async () => {
    const { createMcpSafeAuditEvent, validateMcpAudience } = await import(
      '../src/McpAuthBoundary.js'
    );

    const authContext = {
      issuer: 'https://issuer.example.com',
      subject: 'user-1234',
      subjectClass: 'human-user',
      audience: ['urn:mcp:runtime', 'urn:mcp:registry'],
      clientId: 'mesh-client',
      scopes: ['mcp:tools', 'profile:read'],
      tokenSource: 'authorization-header',
    } as const;

    const result = validateMcpAudience(authContext, {
      expectedAudience: ['urn:mcp:runtime', 'urn:mcp:registry'],
      selectedResource: 'urn:mcp:runtime',
    });

    expect(result.decision).toBe('allow');
    expect(result.selectedAudience).toBe('urn:mcp:runtime');

    const audit = createMcpSafeAuditEvent({
      requestId: 'req-1',
      authContext,
      selectedMcpServer: 'runtime',
      selectedMcpTool: 'calculator',
      policyDecision: result.decision,
      reasonCode: result.reasonCode,
      evidencePointers: result.evidencePointers,
    });

    expect(audit).toEqual(
      expect.objectContaining({
        requestId: 'req-1',
        issuer: 'https://issuer.example.com',
        subjectClass: 'human-user',
        audience: ['urn:mcp:runtime', 'urn:mcp:registry'],
        clientId: 'mesh-client',
        scopes: ['mcp:tools', 'profile:read'],
        tokenSource: 'authorization-header',
        selectedMcpServer: 'runtime',
        selectedMcpTool: 'calculator',
        policyDecision: 'allow',
        reasonCode: 'mcp-audience-accepted',
      }),
    );
    expect(audit.authContextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit)).not.toContain('user-1234');
  });

  it('keeps MCP audience validation separate from tool authorization', async () => {
    const { decideMcpRuntimeAuthority, validateMcpAudience } = await import(
      '../src/McpAuthBoundary.js'
    );
    const tool: Tool = {
      name: 'delete-records',
      description: 'Deletes production records',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    };

    const audience = validateMcpAudience(
      {
        issuer: 'https://issuer.example.com',
        subjectClass: 'service-account',
        audience: 'urn:mcp:runtime',
        clientId: 'automation-client',
        scopes: ['mcp:tools'],
      },
      { expectedAudience: 'urn:mcp:runtime' },
    );
    const authority = decideMcpRuntimeAuthority(tool, {
      auditPolicy: { allowedTools: ['calculator'] },
    });

    expect(audience.decision).toBe('allow');
    expect(authority.decision).toBe('block');
    expect(authority.reasonCode).toBe('mcp-tool-blocked');
    expect(authority.evidencePointers).toContain('tool.findings.tool-not-allowed');
  });
});
