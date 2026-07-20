import { describe, expect, it } from 'vitest';
import {
  REQUIRED_WORKFLOW_MARKERS,
  createDispatchPlan,
  groupRequiredContexts,
} from '../../scripts/dispatch-renovate-checks.mjs';

const renovatePullRequest = {
  number: 169,
  author: { login: 'app/github-actions' },
  headRefName: 'repository-managed-renovate/npm-pnpm-vulnerability',
  headRefOid: 'head-sha',
  baseRefOid: 'base-sha',
};

describe('Renovate required-check dispatch planning', () => {
  it('groups every declarative ruleset context into an owning workflow', () => {
    const grouped = groupRequiredContexts({
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [
              { context: 'CI / lint' },
              { context: 'Docs / links' },
              { context: 'Security / actionlint' },
              { context: 'CodeQL / analyze' },
              { context: 'Scorecard / scan' },
              { context: 'Dependency Review / review' },
            ],
          },
        },
      ],
    });

    expect(grouped).toEqual({
      'ci.yml': ['CI / lint'],
      'docs.yml': ['Docs / links'],
      'security.yml': ['Security / actionlint'],
      'codeql.yml': ['CodeQL / analyze'],
      'scorecard.yml': ['Scorecard / scan'],
      'dependency-review.yml': ['Dependency Review / review'],
    });
  });

  it('dispatches every required workflow for a new Renovate head', () => {
    const plan = createDispatchPlan({
      pullRequests: [renovatePullRequest],
      checkRunsBySha: new Map([['head-sha', new Set()]]),
    });

    expect(plan.map(({ workflow }) => workflow)).toEqual([
      'ci.yml',
      'docs.yml',
      'security.yml',
      'codeql.yml',
      'scorecard.yml',
      'dependency-review.yml',
    ]);
    expect(plan.find(({ workflow }) => workflow === 'docs.yml')?.fields).toEqual({
      deploy: 'false',
    });
    expect(plan.find(({ workflow }) => workflow === 'dependency-review.yml')?.fields).toEqual({
      base_ref: 'base-sha',
      head_ref: 'head-sha',
    });
  });

  it('skips workflow markers already present on the exact head SHA', () => {
    const plan = createDispatchPlan({
      pullRequests: [renovatePullRequest],
      checkRunsBySha: new Map([
        [
          'head-sha',
          new Set([
            ...REQUIRED_WORKFLOW_MARKERS['ci.yml']!,
            ...REQUIRED_WORKFLOW_MARKERS['dependency-review.yml']!,
          ]),
        ],
      ]),
    });

    expect(plan.map(({ workflow }) => workflow)).not.toContain('ci.yml');
    expect(plan.map(({ workflow }) => workflow)).not.toContain('dependency-review.yml');
    expect(plan).toHaveLength(4);
  });

  it('redispatches a workflow when only some required contexts exist', () => {
    const plan = createDispatchPlan({
      pullRequests: [renovatePullRequest],
      checkRunsBySha: new Map([
        [
          'head-sha',
          new Set([
            'CI / lint',
            'Docs / build',
            'Security / audit',
            'CodeQL / analyze',
            'Scorecard / scan',
            'Dependency Review / review',
          ]),
        ],
      ]),
    });

    expect(plan.map(({ workflow }) => workflow)).toEqual(['ci.yml', 'docs.yml', 'security.yml']);
  });

  it('accepts the REST representation of the GitHub Actions bot', () => {
    const plan = createDispatchPlan({
      pullRequests: [
        {
          ...renovatePullRequest,
          author: { login: 'github-actions[bot]' },
        },
      ],
      checkRunsBySha: new Map([['head-sha', new Set()]]),
    });

    expect(plan).toHaveLength(6);
  });

  it('ignores non-Renovate pull requests even when authored by automation', () => {
    const plan = createDispatchPlan({
      pullRequests: [
        renovatePullRequest,
        {
          ...renovatePullRequest,
          number: 170,
          headRefName: 'release-please--branches--main',
        },
      ],
      checkRunsBySha: new Map([['head-sha', new Set()]]),
    });

    expect(new Set(plan.map(({ prNumber }) => prNumber))).toEqual(new Set([169]));
  });
});
