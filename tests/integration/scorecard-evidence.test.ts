import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);

describe('OpenSSF Scorecard evidence', () => {
  it('publishes an explicit required CI test summary check', async () => {
    const workflow = await readFile(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');

    expect(workflow).toContain('test-evidence:');
    expect(workflow).toContain('name: CI / tests-required');
    expect(workflow).toContain('needs: [unit, integration, recovery, conformance]');
    expect(workflow).toContain('if: ${{ always() }}');
    expect(workflow).toContain('UNIT_RESULT: ${{ needs.unit.result }}');
    expect(workflow).toContain('INTEGRATION_RESULT: ${{ needs.integration.result }}');
    expect(workflow).toContain('RECOVERY_RESULT: ${{ needs.recovery.result }}');
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

  it('keeps OpenSSF badge, Scorecard gaps, and published release evidence current', async () => {
    const [
      bestPracticesText,
      openSsfEvidence,
      scorecardEvidence,
      silverReadiness,
      maturityReport,
      releaseEvidence,
      maintainers,
      governance,
    ] = await Promise.all([
      readFile(new URL('.bestpractices.json', repoRoot), 'utf8'),
      readFile(new URL('docs/openssf-evidence.md', repoRoot), 'utf8'),
      readFile(new URL('docs/security/scorecard.md', repoRoot), 'utf8'),
      readFile(new URL('docs/openssf-silver-readiness.md', repoRoot), 'utf8'),
      readFile(new URL('docs/repo-maturity-report.md', repoRoot), 'utf8'),
      readFile(new URL('docs/security/sbom-provenance-evidence-2026-07-03.md', repoRoot), 'utf8'),
      readFile(new URL('MAINTAINERS.md', repoRoot), 'utf8'),
      readFile(new URL('GOVERNANCE.md', repoRoot), 'utf8'),
    ]);
    const bestPractices = JSON.parse(bestPracticesText) as {
      project_id?: number;
      badge_target?: string;
      current_badge?: string;
      passing_achieved_at?: string;
      last_reviewed?: string;
      scorecard?: { observed_at?: string; score?: number; version?: string };
      latest_verified_release?: {
        tag?: string;
        version?: string;
        publish_run_id?: number;
        asset_attestation_run_id?: number;
        package_count?: number;
        asset_count?: number;
      };
    };

    expect(bestPractices).toMatchObject({
      project_id: 13402,
      badge_target: 'maintain-passing',
      current_badge: 'passing',
      passing_achieved_at: '2026-07-03',
      last_reviewed: '2026-07-28',
      scorecard: {
        observed_at: '2026-07-28T00:27:40Z',
        score: 7.1,
        version: 'v5.3.0',
      },
      latest_verified_release: {
        tag: '@a2amesh/runtime-v0.14.0-alpha.1',
        version: '0.14.0-alpha.1',
        publish_run_id: 30231021914,
        asset_attestation_run_id: 30234144129,
        package_count: 6,
        asset_count: 8,
      },
    });

    expect(openSsfEvidence).toContain('Passing badge');
    expect(openSsfEvidence).toContain('2026-07-03');
    expect(openSsfEvidence).toContain('0.14.0-alpha.1');

    for (const check of [
      'Code-Review',
      'Maintained',
      'CII-Best-Practices',
      'Signed-Releases',
      'Branch-Protection',
      'Contributors',
      'CI-Tests',
    ]) {
      expect(scorecardEvidence).toContain(`\`${check}\``);
    }
    expect(scorecardEvidence).toContain('@oaslananka');
    expect(scorecardEvidence).toContain('2026-09-26');
    expect(scorecardEvidence).toContain('0.14.0-alpha.1');
    expect(scorecardEvidence).not.toContain('#119');

    expect(silverReadiness).not.toContain('/issues/125');
    expect(maintainers).not.toContain('/issues/125');
    expect(governance).not.toContain('/issues/125');
    expect(silverReadiness).toContain('0.14.0-alpha.1');
    expect(maturityReport).not.toContain('Human BadgeApp submission');
    expect(maturityReport).not.toContain('Evidence ready but not submitted');

    expect(releaseEvidence).toContain('@a2amesh/runtime-v0.14.0-alpha.1');
    expect(releaseEvidence).toContain('30234144129');
    expect(releaseEvidence).toContain('six published npm packages');
    expect(releaseEvidence).toContain('SLSA provenance v1');
    expect(releaseEvidence).toContain('SHA256SUMS');
  });
});
