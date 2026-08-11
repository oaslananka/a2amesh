import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import {
  invokeMcpTool,
  type McpToolCaller,
  type McpToolInvocationAuditEvent,
} from '../src/client/index.js';

function textResult(text = 'ready') {
  return { content: [{ type: 'text' as const, text }] };
}

function caller(result: unknown = textResult()): McpToolCaller {
  return { callTool: vi.fn(async () => result as never) };
}

describe('bounded MCP tool invocation', () => {
  it('denies tools outside the exact allowlist before calling the client', async () => {
    const client = caller();
    await expect(
      invokeMcpTool({ client, tool: 'repo.read', allowedTools: ['repo.list'] }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-tool-not-allowed' });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized input before calling the client', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const client = caller();
    await expect(
      invokeMcpTool({ client, tool: 'repo.read', allowedTools: ['repo.read'], input: circular }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-input-invalid' });
    await expect(
      invokeMcpTool({
        client,
        tool: 'repo.read',
        allowedTools: ['repo.read'],
        input: { value: 'x'.repeat(128) },
        maxInputBytes: 32,
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-input-too-large' });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('distinguishes timeout and parent cancellation', async () => {
    const pending = { callTool: vi.fn(() => new Promise<never>(() => undefined)) };
    await expect(
      invokeMcpTool({
        client: pending,
        tool: 'repo.read',
        allowedTools: ['repo.read'],
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-operation-timeout' });

    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      invokeMcpTool({
        client: pending,
        tool: 'repo.read',
        allowedTools: ['repo.read'],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-operation-cancelled' });
  });

  it('normalizes client failures without exposing downstream error text', async () => {
    const events: McpToolInvocationAuditEvent[] = [];
    const client = {
      callTool: vi.fn(async () => Promise.reject(new Error('provider-secret-error'))),
    };
    await expect(
      invokeMcpTool({
        client,
        tool: 'repo.read',
        allowedTools: ['repo.read'],
        audit: (e) => {
          events.push(e);
        },
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-operation-failed' });
    expect(JSON.stringify(events)).not.toContain('provider-secret-error');
  });

  it('rejects invalid and oversized results', async () => {
    await expect(
      invokeMcpTool({
        client: caller({ content: [{ type: 'text' }] }),
        tool: 'repo.read',
        allowedTools: ['repo.read'],
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-result-invalid' });
    await expect(
      invokeMcpTool({
        client: caller(textResult('x'.repeat(128))),
        tool: 'repo.read',
        allowedTools: ['repo.read'],
        maxResultBytes: 32,
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-result-too-large' });
  });

  it('returns validated results and emits hash-only audit evidence', async () => {
    const events: McpToolInvocationAuditEvent[] = [];
    const result = await invokeMcpTool({
      client: caller(textResult('safe-result')),
      tool: 'repo.read',
      input: { query: 'private-input' },
      allowedTools: ['repo.read'],
      audit: (event) => {
        events.push(event);
      },
    });
    assert.equal(result.content[0]?.type, 'text');
    assert.equal(events.length, 1);
    expect(events[0]).toMatchObject({
      tool: 'repo.read',
      outcome: 'succeeded',
      reasonCode: 'mcp-operation-succeeded',
    });
    assert.match(events[0]?.inputHash ?? '', /^[a-f0-9]{64}$/u);
    assert.match(events[0]?.outputHash ?? '', /^[a-f0-9]{64}$/u);
    const auditJson = JSON.stringify(events);
    assert.doesNotMatch(auditJson, /private-input|safe-result/u);
  });

  it('fails closed when audit delivery fails', async () => {
    await expect(
      invokeMcpTool({
        client: caller(),
        tool: 'repo.read',
        allowedTools: ['repo.read'],
        audit: async () => Promise.reject(new Error('audit backend failed')),
      }),
    ).rejects.toMatchObject({ reasonCode: 'mcp-audit-failed' });
  });
});

describe('official MCP SDK client compatibility', () => {
  it('invokes a real SDK server through an in-memory client transport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: 'fixture', version: '1.0.0' });
    server.registerTool(
      'deployment.readiness',
      { description: 'Return deterministic readiness evidence' },
      async () => textResult('ready'),
    );
    const client = new Client({ name: 'a2amesh-bounded-test', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await invokeMcpTool({
        client,
        tool: 'deployment.readiness',
        input: { service: 'payment-api' },
        allowedTools: ['deployment.readiness'],
      });
      assert.match(JSON.stringify(result), /ready/u);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
