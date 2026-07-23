import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(path, repoRoot), 'utf8');
}

describe('repository governance policy', () => {
  it('keeps one canonical CODEOWNERS file with sensitive-path coverage', async () => {
    const codeowners = await readRepoFile('.github/CODEOWNERS');
    const requiredPatterns = [
      '* @oaslananka',
      '/packages/protocol/ @oaslananka',
      '/packages/runtime/ @oaslananka',
      '/packages/mcp/ @oaslananka',
      '/packages/registry/ @oaslananka',
      '/deploy/ @oaslananka',
      '/ops/ @oaslananka',
      '/.github/workflows/ @oaslananka',
      '/.github/rulesets/ @oaslananka',
      '/.github/GOVERNANCE.md @oaslananka',
      '/SECURITY.md @oaslananka',
    ];

    for (const pattern of requiredPatterns) {
      expect(codeowners).toContain(pattern);
    }

    await expect(access(new URL('CODEOWNERS', repoRoot))).rejects.toThrow();
  });

  it('defines objective review escalation, succession, and access-review controls', async () => {
    const governance = await readRepoFile('.github/GOVERNANCE.md');

    expect(governance).toContain('two active maintainers');
    expect(governance).toContain('required approving review count to `1`');
    expect(governance).toContain('require code-owner review');
    expect(governance).toContain('quarterly');
    expect(governance).toContain('retrospective');
    expect(governance).toContain('succession');
    expect(governance).toContain('security escalation');
    expect(governance).toContain('decision record');
  });

  it('keeps the staged solo-maintainer ruleset aligned with the public policy', async () => {
    const [rulesetText, policy] = await Promise.all([
      readRepoFile('.github/rulesets/main.json'),
      readRepoFile('docs/governance/vulnerability-reporting-and-review-policy.md'),
    ]);
    const ruleset = JSON.parse(rulesetText) as {
      rules: Array<{
        type: string;
        parameters?: {
          required_approving_review_count?: number;
          dismiss_stale_reviews_on_push?: boolean;
          require_code_owner_review?: boolean;
          require_last_push_approval?: boolean;
        };
      }>;
    };
    const pullRequestRule = ruleset.rules.find((rule) => rule.type === 'pull_request');

    expect(pullRequestRule?.parameters).toMatchObject({
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
    });
    expect(policy).toContain('two active maintainers');
    expect(policy).toContain('quarterly access and ruleset review');
  });
});
