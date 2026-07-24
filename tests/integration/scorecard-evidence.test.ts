import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);

describe('OpenSSF Scorecard evidence', () => {
  it('publishes an explicit required CI test summary check', async () => {
    const workflow = await readFile(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');

    expect(workflow).toContain('test-evidence:');
    expect(workflow).toContain('name: CI / tests-required');
    expect(workflow).toContain('needs: [unit, integration, conformance]');
    expect(workflow).toContain('if: ${{ always() }}');
    expect(workflow).toContain('UNIT_RESULT: ${{ needs.unit.result }}');
    expect(workflow).toContain('INTEGRATION_RESULT: ${{ needs.integration.result }}');
    expect(workflow).toContain('CONFORMANCE_RESULT: ${{ needs.conformance.result }}');
    expect(workflow).toContain('Required test job failed or was cancelled');
    expect(workflow).not.toContain('permissions:\n  contents: read');
    expect(workflow).toContain('permissions: {}');

    const jobs = workflow.slice(workflow.indexOf('jobs:\n') + 'jobs:\n'.length);
    const jobBlocks = jobs.split(/\n(?= {2}[a-z0-9-]+:\n)/).filter(Boolean);
    expect(jobBlocks.length).toBeGreaterThan(0);
    for (const block of jobBlocks) {
      const jobName = block.match(/^ {2}([a-z0-9-]+):/)?.[1] ?? '<unknown>';
      expect(block, `${jobName} must declare contents: read`).toContain(
        '    permissions:\n      contents: read',
      );
    }
  });

  it('keeps the CI test evidence check in branch-protection sources', async () => {
    const [ruleset, documentation] = await Promise.all([
      readFile(new URL('.github/rulesets/main.json', repoRoot), 'utf8'),
      readFile(new URL('docs/release/branch-protection.md', repoRoot), 'utf8'),
    ]);

    expect(ruleset).toContain('"context": "CI / required-summary"');
    expect(ruleset).toContain('"context": "CI / tests-required"');
    expect(ruleset).not.toContain('"context": "CI / conformance"');
    expect(ruleset).not.toContain('"context": "CI / gc"');
    expect(documentation).toContain('`CI / required-summary`');
    expect(documentation).toContain('`CI / tests-required`');
    expect(documentation).toContain('conformance');
    expect(documentation).toMatch(/garbage\s+collection/);
    expect(documentation).toContain('classic branch protection');
    expect(documentation).toContain('declarative desired state');
  });

  it('documents non-code Scorecard limitations without stale issue references', async () => {
    const policy = await readFile(
      new URL('docs/governance/vulnerability-reporting-and-review-policy.md', repoRoot),
      'utf8',
    );

    expect(policy).toContain('Scorecard `Code-Review`');
    expect(policy).toContain('Scorecard `Maintained`');
    expect(policy).toContain('CI / tests-required');
    expect(policy).toContain('2026-06-28');
    expect(policy).not.toContain('(#69');
    expect(policy).not.toContain('(#70');
  });
});
