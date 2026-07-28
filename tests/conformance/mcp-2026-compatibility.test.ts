import { describe, expect, it } from 'vitest';
import {
  createMcpBridgeAuditEvent,
  evaluateMcpBridgeAuthorization,
  type McpBridgeSecurityPolicy,
} from '../../packages/mcp/src/McpBridgeSecurity.js';
import {
  evaluateMcpNextProbeResult,
  loadMcpNextContract,
  validateMcpNextContract,
  validateMcpNextProbePayload,
} from '../../scripts/mcp-compatibility.mjs';

const REQUIRED_SURFACES = [
  'connection.bootstrap',
  'session.state',
  'request.metadata',
  'http.headers',
  'tools.discovery',
  'tools.call',
  'cache.hints',
  'errors.unsupported-version',
  'cancellation',
  'tracing',
  'authorization',
  'tasks.extension',
  'apps.extension',
  'deprecated.server-requests',
] as const;

describe('MCP 2026-07-28 compatibility contract', () => {
  it('records an explicit migration and rollback decision for every relevant surface', () => {
    const contract = loadMcpNextContract();

    expect(contract.protocolVersion).toBe('2026-07-28');
    expect(contract.stableSdkRange).toBe('^1.29.0');
    expect(contract.candidateSdk).toEqual({
      client: '2.0.0',
      core: '2.0.0',
      node: '2.0.0',
      server: '2.0.0',
    });
    expect(contract.surfaces.map((surface) => surface.id)).toEqual(REQUIRED_SURFACES);
    expect(validateMcpNextContract(contract)).toEqual([]);
    expect(
      contract.surfaces.every(
        (surface) =>
          surface.current.length > 0 &&
          surface.next.length > 0 &&
          surface.decision.length > 0 &&
          surface.evidence.length > 0 &&
          surface.rollback.length > 0,
      ),
    ).toBe(true);
  });

  it('keeps modern negotiation explicit and preserves the legacy initialize fixture', () => {
    const contract = loadMcpNextContract();
    const legacy = contract.fixtures['legacy-initialize-request'];
    const discover = contract.fixtures['discover-request'];

    expect(legacy).toMatchObject({ method: 'initialize' });
    expect(discover).toMatchObject({
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        },
      },
    });
    expect(discover.method).not.toBe(legacy.method);
  });

  it('binds modern tool calls to method, name, protocol, client, and trace metadata', () => {
    const contract = loadMcpNextContract();
    const fixture = contract.fixtures['tool-call-request'];

    expect(fixture.headers).toMatchObject({
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'research-agent',
    });
    expect(fixture.body).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'research-agent',
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': {
            name: 'a2amesh-compat-client',
          },
          traceparent: expect.stringMatching(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/),
          tracestate: 'vendor=opaque',
        },
      },
    });
  });

  it('requires deterministic tool ordering and explicit cache hints', () => {
    const contract = loadMcpNextContract();
    const result = contract.fixtures['tools-list-result'];
    const names = result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toEqual([...names].sort());
    expect(result).toMatchObject({ ttlMs: 120_000, cacheScope: 'public' });
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers unsupported versions, cancellation, and an auth denial without secrets', () => {
    const contract = loadMcpNextContract();
    const serialized = JSON.stringify({
      unsupported: contract.fixtures['unsupported-version-error'],
      cancellation: contract.fixtures['cancelled-notification'],
      auth: contract.fixtures['auth-denied'],
    });

    expect(contract.fixtures['unsupported-version-error']).toMatchObject({
      error: {
        code: -32022,
        data: { requested: '2099-01-01', supported: ['2026-07-28'] },
      },
    });
    expect(contract.fixtures['cancelled-notification']).toMatchObject({
      method: 'notifications/cancelled',
    });
    expect(contract.fixtures['auth-denied']).toMatchObject({ status: 401 });
    expect(serialized).not.toMatch(/bearer|api[_-]?key|secret|token-value/i);
  });

  it('keeps bridge approval, consent, audit, and credential boundaries authoritative for modern calls', () => {
    const contract = loadMcpNextContract();
    const modernCall = contract.fixtures['tool-call-request'];
    const tool = {
      name: modernCall.body.params.name,
      description: 'Reads bounded research data after explicit approval.',
      inputSchema: {
        type: 'object' as const,
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
    };
    const input = {
      ...modernCall.body.params.arguments,
      message: 'private-modern-message',
      _meta: modernCall.body.params._meta,
    };
    const policy: McpBridgeSecurityPolicy = {
      requestId: 'mcp-next-policy-1',
      tenantId: 'tenant-a',
      expectedTenantId: 'tenant-a',
      authContext: {
        subject: 'private-modern-subject',
        subjectClass: 'human-user',
        audience: 'urn:mcp:a2a-bridge',
        clientId: 'a2amesh-compat-client',
        scopes: ['mcp:tools'],
        tokenSource: 'authorization-header',
      },
      audiencePolicy: { expectedAudience: 'urn:mcp:a2a-bridge' },
      authorityPolicy: {
        auditPolicy: {
          allowedTools: ['research-agent'],
          approvalRequiredTools: ['research-agent'],
        },
      },
      requiredScopes: ['mcp:tools'],
      consent: { decision: 'approved', approvalId: 'approval-modern-1' },
    };

    const allowed = evaluateMcpBridgeAuthorization(tool, input, policy);
    const pending = evaluateMcpBridgeAuthorization(tool, input, {
      ...policy,
      consent: { decision: 'pending' },
    });
    const wrongScope = evaluateMcpBridgeAuthorization(tool, input, {
      ...policy,
      requiredScopes: ['mcp:admin'],
    });
    const audit = createMcpBridgeAuditEvent({
      tool,
      input,
      policy,
      phase: 'authorization',
      decision: allowed.decision,
      outcome: 'allowed',
      reasonCode: allowed.reasonCode,
      evidencePointers: allowed.evidencePointers,
    });

    expect(allowed).toMatchObject({
      decision: 'allow',
      reasonCode: 'mcp-explicit-consent-accepted',
    });
    expect(pending).toMatchObject({ decision: 'block', reasonCode: 'mcp-consent-required' });
    expect(wrongScope).toMatchObject({ decision: 'block', reasonCode: 'mcp-scope-missing' });
    expect(audit.authContextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit)).not.toContain('private-modern-message');
    expect(JSON.stringify(audit)).not.toContain('private-modern-subject');
    expect(JSON.stringify(audit)).not.toContain('approval-modern-1');
  });

  it('validates the exact SDK v2 golden probe and rejects a legacy fallback', () => {
    const contract = loadMcpNextContract();
    const golden = contract.fixtures['sdk-v2-probe-result'];

    expect(validateMcpNextProbePayload(golden)).toEqual([]);
    expect(
      validateMcpNextProbePayload({
        ...golden,
        protocolVersion: '2025-11-25',
        sawInitialize: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        'candidate probe must negotiate 2026-07-28',
        'candidate probe must not use initialize',
      ]),
    );
  });

  it('reports candidate SDK failures without leaking raw credentials', () => {
    const credential = ['candidate', 'secret', 'value'].join('-');
    const report = evaluateMcpNextProbeResult({
      exitCode: 1,
      stdout: '',
      stderr: [['Authorization:', 'Bearer', credential].join(' '), 'request failed'].join('\n'),
    });

    expect(report.status).toBe('incompatible');
    expect(report.summary).toContain('[REDACTED]');
    expect(report.summary).not.toContain(credential);
    expect(report.exitCode).toBe(1);
  });
});
