import { describe, expect, it } from 'vitest';
import {
  createGitWorktreeCheckFromStatus,
  createReleaseCheckCommand,
  createReleaseCheckPlan,
  createReleaseCheckReport,
} from '../src/commands/release-check.js';
import { expectCommandHelp, jsonOptions } from './command-test-helpers.js';

describe('release-check command', () => {
  it('defines the release-check command', () => {
    const command = createReleaseCheckCommand(jsonOptions);

    expect(command.name()).toBe('release-check');
    expectCommandHelp(command, ['release-check']);
  });

  it('exposes actionable local release gate metadata', () => {
    const plan = createReleaseCheckPlan();

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Git worktree clean',
          command: 'git status --porcelain',
          ciEquivalent: 'CI / no-generated-artifacts',
          remediation: expect.stringContaining('Commit'),
        }),
        expect.objectContaining({
          name: 'Docs build',
          command: 'pnpm run docs:build',
          ciEquivalent: 'Docs / build',
        }),
        expect.objectContaining({
          name: 'Security audit',
          command: 'pnpm audit --audit-level high',
          ciEquivalent: 'Security / audit',
        }),
      ]),
    );
  });


  it('fails dirty worktrees with remediation metadata', () => {
    const check = createGitWorktreeCheckFromStatus(' M packages/cli/src/index.ts', 12);

    expect(check).toEqual(
      expect.objectContaining({
        name: 'Git worktree clean',
        status: 'failed',
        duration: 12,
        command: 'git status --porcelain',
        ciEquivalent: 'CI / no-generated-artifacts',
        remediation: expect.stringContaining('Commit'),
        error: 'M packages/cli/src/index.ts',
      }),
    );
  });

  it('summarizes actionable release-check failures', () => {
    const dirty = createGitWorktreeCheckFromStatus(' M README.md', 5);
    const clean = createGitWorktreeCheckFromStatus('', 3);
    const report = createReleaseCheckReport([dirty, clean]);

    expect(report.ready).toBe(false);
    expect(report.localGate.id).toBe('release-check');
    expect(report.summary).toEqual(
      expect.objectContaining({
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        duration: 8,
      }),
    );
    expect(report.summary.actionableFailures).toEqual([
      expect.objectContaining({
        name: 'Git worktree clean',
        remediation: expect.stringContaining('Commit'),
      }),
    ]);
  });

});
