import assert from 'node:assert/strict';
import test from 'node:test';
import { runExample } from '../src/index.js';

void test('agent mesh example discovers agents and pipelines a task between them', async () => {
  const result = await runExample();

  assert.equal(result.mode, 'agent-mesh');
  assert.deepEqual(result.discovered, ['Researcher', 'Summarizer']);
  assert.match(result.researchNotes, /Agent2Agent \(A2A\) protocol/u);
  assert.match(result.summary, /^Summary: /u);
});
