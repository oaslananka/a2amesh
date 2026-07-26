import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts: Record<string, string>;
}

const execFileAsync = promisify(execFile);
const repoRoot = new URL('../..', import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL('package.json', repoRoot), 'utf8'),
) as PackageJson;
const scripts = packageJson.scripts;

const buildFreeScripts = [
  'typecheck:no-build',
  'test:unit:no-build',
  'test:integration:no-build',
  'test:conformance:no-build',
  'test:coverage:no-build',
  'test:coverage:ci:no-build',
  'perf:smoke:no-build',
  'schemas:check:no-build',
  'openapi:check:no-build',
  'docs:check:no-build',
] as const;

describe('verification pipeline', () => {
  it('provides explicit clean, warm, and build-free verification entry points', async () => {
    expect(scripts['clean:build']).toBe('node scripts/clean-build-outputs.mjs');
    expect(scripts['build:clean']).toBe('pnpm run clean:build && pnpm run build');
    expect(scripts['verify']).toBe('node scripts/run-verification.mjs');
    expect(scripts['verify:clean']).toBe('node scripts/run-verification.mjs --clean');
    expect(scripts['verify:changed']).toBe(
      'git diff --check origin/main...HEAD && pnpm run lint && pnpm run typecheck:no-build && pnpm run test:unit:changed',
    );
    expect(scripts['check:pre-push']).toBe('pnpm run verify:changed');

    for (const scriptName of buildFreeScripts) {
      expect(scripts[scriptName], `${scriptName} must exist`).toBeTypeOf('string');
      expect(scripts[scriptName], `${scriptName} must not rebuild`).not.toContain('pnpm run build');
    }

    expect(scripts['examples:smoke']).toBe('pnpm run build && pnpm run examples:smoke:no-build');
    expect(scripts['examples:smoke:no-build']).toBe('node scripts/run-examples-smoke.mjs');
    expect(scripts['test:integration:no-build']).toContain('pnpm run examples:smoke:no-build');

    const exampleRunner = await readFile(
      new URL('scripts/run-examples-smoke.mjs', repoRoot),
      'utf8',
    );
    expect(exampleRunner).not.toContain("runPnpmSync(['run', 'build']");
  });

  it('plans exactly one build and records timing budgets for warm and clean verification', async () => {
    const runner = new URL('scripts/run-verification.mjs', repoRoot);
    const warm = JSON.parse(
      (await execFileAsync(process.execPath, [runner.pathname, '--plan'])).stdout,
    ) as { mode: string; budgetMs: number; stages: Array<{ id: string; script: string }> };
    const clean = JSON.parse(
      (await execFileAsync(process.execPath, [runner.pathname, '--clean', '--plan'])).stdout,
    ) as { mode: string; budgetMs: number; stages: Array<{ id: string; script: string }> };

    expect(warm.mode).toBe('warm');
    expect(clean.mode).toBe('clean');
    expect(warm.budgetMs).toBeGreaterThan(0);
    expect(clean.budgetMs).toBeGreaterThan(warm.budgetMs);
    expect(warm.stages.filter((stage) => stage.id === 'build')).toEqual([
      { id: 'build', script: 'build' },
    ]);
    expect(clean.stages.filter((stage) => stage.id === 'build')).toEqual([
      { id: 'build', script: 'build:clean' },
    ]);
    expect(
      warm.stages.filter((stage) =>
        [
          'build',
          'build:clean',
          'typecheck',
          'test:coverage',
          'test:integration',
          'test:conformance',
          'schemas:check',
          'docs:check',
        ].includes(stage.script),
      ),
    ).toEqual([{ id: 'build', script: 'build' }]);
    expect(warm.stages.map((stage) => stage.script)).toContain('build:manifest');
    expect(warm.stages.map((stage) => stage.script)).toContain('test:coverage:no-build');
    expect(warm.stages.map((stage) => stage.script)).toContain('test:integration:no-build');
    expect(warm.stages.map((stage) => stage.script)).toContain('schemas:check:no-build');
    expect(warm.stages.map((stage) => stage.script)).toContain('docs:check:no-build');
    expect(warm.stages.map((stage) => stage.script)).not.toContain('docs:build');

    const source = await readFile(runner, 'utf8');
    expect(source).toContain('.artifacts/verification/timings.json');
    expect(source).toContain('.artifacts/verification/timings.md');
    expect(source).toContain('GITHUB_STEP_SUMMARY');
  });

  it('shares one commit-scoped build artifact across build-dependent CI jobs', async () => {
    const workflow = await readFile(new URL('.github/workflows/ci.yml', repoRoot), 'utf8');
    const restoreAction = await readFile(
      new URL('.github/actions/restore-workspace-build/action.yml', repoRoot),
      'utf8',
    );
    const jobBlock = (jobName: string) => {
      const marker = `\n  ${jobName}:\n`;
      const start = workflow.indexOf(marker);
      expect(start, `${jobName} job must exist`).toBeGreaterThan(-1);
      const bodyStart = start + marker.length;
      const next = workflow.slice(bodyStart).search(/\n {2}[a-z][a-z0-9-]*:\n/);
      return workflow.slice(start, next === -1 ? undefined : bodyStart + next);
    };

    const artifactName = 'workspace-build-${{ github.sha }}-${{ github.run_attempt }}';
    const build = jobBlock('build');
    expect(build).toContain('pnpm run build:clean');
    expect(build).toContain('pnpm run build:manifest');
    expect(build).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    expect(build).not.toContain('docs-site/.vitepress/dist/');
    expect(build).toContain(`name: ${artifactName}`);
    expect(build).toContain('include-hidden-files: true');
    expect(build).toContain('.artifacts/build/manifest.json');
    expect(build).toContain('packages/*/node_modules/.cache/tsconfig.tsbuildinfo');

    const dependentJobs = new Map([
      ['typecheck', 'pnpm run typecheck:no-build'],
      ['unit', 'pnpm run test:coverage:ci:no-build'],
      ['integration', 'pnpm run test:integration:no-build'],
      ['performance-smoke', 'pnpm run perf:smoke:no-build'],
      ['conformance', 'pnpm run test:conformance:no-build'],
      ['schemas', 'pnpm run schemas:check:no-build'],
      ['mutation', 'pnpm run test:mutation'],
      ['ui-e2e', 'pnpm run ui:install:browsers'],
      ['package-dry-run', 'pnpm run pack:dry-run'],
    ]);
    for (const [jobName, command] of dependentJobs) {
      const job = jobBlock(jobName);
      expect(job, `${jobName} must depend on build`).toMatch(/needs:.*build/);
      expect(job).toContain('uses: ./.github/actions/restore-workspace-build');
      expect(job).toContain(`artifact-name: ${artifactName}`);
      expect(job).toContain(command);
      expect(job).not.toMatch(/^\s*- run: pnpm run build$/m);
      expect(job).not.toMatch(
        /^\s*- run: pnpm run (typecheck|test:coverage:ci|test:integration|perf:smoke|test:conformance|schemas:check)$/m,
      );
    }

    expect(restoreAction).toContain(
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    );
    expect(restoreAction).toContain('node scripts/build-artifact-manifest.mjs --verify');
    expect(restoreAction).toContain('node scripts/sync-injected-workspace-dist.mjs');
  });

  it('documents timing evidence, regression budgets, and cache isolation', async () => {
    const guide = await readFile(
      new URL('docs/development/verification-performance.md', repoRoot),
      'utf8',
    );
    const testing = await readFile(new URL('docs/development/testing.md', repoRoot), 'utf8');
    const localSetup = await readFile(new URL('docs/development/local-setup.md', repoRoot), 'utf8');

    expect(scripts['verify:budget']).toBe('node scripts/run-verification.mjs --enforce-budget');
    expect(scripts['verify:clean:budget']).toBe(
      'node scripts/run-verification.mjs --clean --enforce-budget',
    );
    expect(guide).toContain('30 minutes');
    expect(guide).toContain('45 minutes');
    expect(guide).toContain('.artifacts/verification/timings.json');
    expect(guide).toContain('workspace-build-${{ github.sha }}-${{ github.run_attempt }}');
    expect(guide).toContain('SHA-256');
    expect(guide).toContain('pnpm run verify:changed');
    expect(guide).toContain('pnpm run build:clean');
    expect(guide).toContain('331.48 seconds');
    expect(testing).toContain('verification-performance.md');
    expect(localSetup).toContain('verification-performance.md');
  });
});
