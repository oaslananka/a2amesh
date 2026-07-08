import assert from 'node:assert/strict';
import test from 'node:test';
import { runExample } from '../src/index.js';

void test('local CLI fleet example routes and runs a task through the bundled stand-in command', async () => {
  // Deliberately does not set A2AMESH_CLI_FLEET_COMMAND: this only exercises
  // the default `node` stand-in path, so the test never depends on an
  // external CLI being installed.
  const result = await runExample();

  assert.equal(result.mode, 'local-cli-fleet');
  assert.ok(result.selectedWorkerId, 'a worker should have been routed');
  assert.equal(result.runStatus, 'COMPLETED');
  assert.equal(result.artifactName, 'out.patch');
  assert.match(result.artifactChecksum ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(result.plan.credentialPolicy, 'env-ref');
});
