import assert from 'node:assert/strict';
import test from 'node:test';
import { runProbe } from './probe.mjs';

test('runs an explicit modern SDK v2 tool discovery and call without legacy initialization', async () => {
  const result = await runProbe();

  assert.deepEqual(result.sdk, {
    client: '2.0.0',
    core: '2.0.0',
    node: '2.0.0',
    server: '2.0.0',
  });
  assert.equal(result.protocolVersion, '2026-07-28');
  assert.equal(result.unauthorizedStatus, 401);
  assert.deepEqual(result.methods, ['server/discover', 'tools/list', 'tools/call']);
  assert.equal(result.sawInitialize, false);
  assert.deepEqual(result.tools, {
    names: ['research-agent', 'summary-agent'],
    ttlMs: 120000,
    cacheScope: 'public',
  });
  assert.deepEqual(result.call, { text: 'fixture-ok' });
});

test('binds modern method and tool-name headers to the request body without emitting credentials', async () => {
  const result = await runProbe();
  const call = result.requests.find((request) => request.method === 'tools/call');

  assert.ok(call);
  assert.equal(call.protocolVersion, '2026-07-28');
  assert.equal(call.methodHeader, call.method);
  assert.equal(call.nameHeader, call.name);
  assert.equal(call.hasCredential, true);
  assert.doesNotMatch(JSON.stringify(result), /fixture-credential|bearer/i);
});
