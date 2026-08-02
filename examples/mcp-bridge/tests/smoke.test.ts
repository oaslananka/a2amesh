import assert from 'node:assert/strict';
import test from 'node:test';
import { formatExampleFailure, runExample } from '../src/index.js';

void test('mcp bridge example maps tools and runs the policy-backed Fleet worker', async () => {
  const result = await runExample();

  assert.equal(result.mode, 'mcp-bridge');
  assert.equal(result.mcpToolName, 'research-agent');
  assert.equal(result.a2aSkillId, 'mcp-calculator');
  assert.equal(result.output, 'mcp bridge response');
  assert.equal(result.workerRunStatus, 'COMPLETED');
  assert.match(result.workerArtifactChecksum ?? '', /^[a-f0-9]{64}$/u);
});

void test('mcp bridge example keeps configuration failures credential-safe', () => {
  const message = formatExampleFailure(new Error('provider-secret-value'));
  assert.equal(message, 'MCP bridge example failed. Review configuration and policy.');
  assert.doesNotMatch(message, /provider-secret-value/u);
});
