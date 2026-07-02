import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { emitResult, writeError, type RootOptionsProvider } from '../io.js';
import { getLocalReleaseGates, type LocalReleaseGate } from '../release-gates.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const releaseCheckCommandDoc = {
  path: ['release-check'],
  summary: 'Check release readiness.',
  description:
    'Runs the full release readiness checklist: git worktree state, release config integrity, pack dry-run, schema generation, docs build, security audit, public surface, package registry parity, and release artifact validation. Exits non-zero if any check fails.',
  examples: [
    {
      title: 'Run release readiness checks.',
      bash: ['a2amesh release-check'],
      powershell: ['a2amesh release-check'],
    },
    {
      title: 'Emit machine-readable JSON report.',
      bash: ['a2amesh release-check --json'],
      powershell: ['a2amesh release-check --json'],
    },
  ],
} satisfies CliCommandDoc;

export interface CheckResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  command?: string;
  ciEquivalent?: string;
  remediation?: string;
  error?: string;
}

interface ActionableFailure {
  name: string;
  error?: string | undefined;
  remediation?: string | undefined;
}

export interface ReleaseCheckReport {
  command: 'release-check';
  checks: CheckResult[];
  localGate: LocalReleaseGate;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    actionableFailures: ActionableFailure[];
  };
  ready: boolean;
}

const RELEASE_CHECK_METADATA = new Map<
  string,
  Pick<CheckResult, 'command' | 'ciEquivalent' | 'remediation'>
>([
  [
    'Git worktree clean',
    {
      command: 'git status --porcelain',
      ciEquivalent: 'CI / no-generated-artifacts',
      remediation: 'Commit, stash, or revert local changes before release validation.',
    },
  ],
  [
    'Release config',
    {
      command: 'node scripts/check-release-config.mjs',
      ciEquivalent: 'CI / package-dry-run',
      remediation: 'Fix release config, linked package versions, or publish metadata.',
    },
  ],
  [
    'Pack dry-run',
    {
      command: 'node scripts/check-npm-pack.mjs',
      ciEquivalent: 'CI / package-dry-run',
      remediation: 'Fix package files, bin wrappers, or packed artifact contents.',
    },
  ],
  [
    'Schema generation',
    {
      command: 'node scripts/generate-json-schemas.mjs',
      ciEquivalent: 'CI / schemas',
      remediation: 'Regenerate schemas and commit matching generated artifacts.',
    },
  ],
  [
    'Docs build',
    {
      command: 'pnpm run docs:build',
      ciEquivalent: 'Docs / build',
      remediation: 'Fix docs links, examples, markdown, or VitePress build errors.',
    },
  ],
  [
    'Security audit',
    {
      command: 'pnpm audit --audit-level high',
      ciEquivalent: 'Security / audit',
      remediation: 'Upgrade, patch, or document vulnerable dependencies before release.',
    },
  ],
  [
    'Public surface',
    {
      command: 'node scripts/check-public-surface.mjs',
      ciEquivalent: 'CI / public-surface',
      remediation: 'Update public surface manifests for intentional exported API changes.',
    },
  ],
  [
    'Command surface',
    {
      command: 'node scripts/check-command-surface.mjs',
      ciEquivalent: 'CI / command-surface',
      remediation: 'Update CLI command docs and generated command surface metadata.',
    },
  ],
  [
    'Package parity',
    {
      command: 'node scripts/check-package-registry-parity.mjs',
      ciEquivalent: 'CI / package-dry-run',
      remediation: 'Wait for registry propagation or fix missing/mismatched package versions.',
    },
  ],
  [
    'Release artifacts',
    {
      command: 'pnpm run release:artifacts',
      ciEquivalent: 'CI / package-dry-run',
      remediation: 'Fix artifact generation before publishing or attaching release evidence.',
    },
  ],
]);

export function createReleaseCheckPlan(): Array<
  Pick<CheckResult, 'name' | 'command' | 'ciEquivalent' | 'remediation'>
> {
  return Array.from(RELEASE_CHECK_METADATA, ([name, metadata]) => ({ name, ...metadata }));
}

function annotateCheck(result: CheckResult): CheckResult {
  const metadata = RELEASE_CHECK_METADATA.get(result.name);
  return metadata ? { ...metadata, ...result } : result;
}

function releaseCheckGate(): LocalReleaseGate {
  return (
    getLocalReleaseGates().find((entry) => entry.id === 'release-check') ?? {
      id: 'release-check',
      command: 'a2amesh release-check --json',
      ciEquivalent: 'CI / package-dry-run, CI / schemas, Docs / build, Security / audit',
      purpose: 'Run local release readiness checks.',
      remediation: 'Fix failed local checks and rerun release-check.',
    }
  );
}

function actionableFailures(checks: readonly CheckResult[]): ActionableFailure[] {
  return checks
    .filter((check) => check.status === 'failed')
    .map((check) => ({
      name: check.name,
      error: check.error,
      remediation: check.remediation,
    }));
}

function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export function createGitWorktreeCheckFromStatus(output: string, duration = 0): CheckResult {
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    return annotateCheck({
      name: 'Git worktree clean',
      status: 'failed',
      duration,
      error: trimmed.split('\n').slice(0, 10).join('\n'),
    });
  }
  return annotateCheck({ name: 'Git worktree clean', status: 'passed', duration });
}

export function createReleaseCheckReport(checks: CheckResult[]): ReleaseCheckReport {
  const total = checks.length;
  const passed = checks.filter((check) => check.status === 'passed').length;
  const failed = checks.filter((check) => check.status === 'failed').length;
  const skipped = checks.filter((check) => check.status === 'skipped').length;
  const totalDuration = checks.reduce((sum, check) => sum + check.duration, 0);
  const failures = actionableFailures(checks);

  return {
    command: 'release-check',
    localGate: releaseCheckGate(),
    checks,
    summary: {
      total,
      passed,
      failed,
      skipped,
      duration: totalDuration,
      actionableFailures: failures,
    },
    ready: failed === 0,
  };
}

function runCheck(
  name: string,
  command: string,
  args: readonly string[],
  options: ExecFileSyncOptions,
): CheckResult {
  const start = performance.now();
  const file =
    process.platform === 'win32' && command.toLowerCase().endsWith('.cmd') ? 'cmd.exe' : command;
  // Quote the .cmd path so cmd.exe /c treats it as a single token even if
  // the absolute path contains spaces.  execFileSync already avoids a
  // shell, but /c still concatenates the remaining arguments into one
  // command line string.
  const commandArgs =
    process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
      ? ['/d', '/s', '/c', `"${command}"`, ...args]
      : args;
  try {
    execFileSync(file, commandArgs, { ...options, stdio: 'pipe', timeout: 120_000 });
    return annotateCheck({
      name,
      status: 'passed',
      duration: Math.round(performance.now() - start),
    });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer };
    const message = err.stderr?.toString().trim() || err.stdout?.toString().trim() || err.message;
    return annotateCheck({
      name,
      status: 'failed',
      duration: Math.round(performance.now() - start),
      error: message || 'Unknown error',
    });
  }
}

function runNodeScript(name: string, script: string, cwd: string): CheckResult {
  return runCheck(name, process.execPath, [script], { cwd });
}

function runPnpm(name: string, args: readonly string[], cwd: string): CheckResult {
  const pnpmExecPath = process.env['npm_execpath'];
  if (pnpmExecPath) {
    return runCheck(name, process.execPath, [pnpmExecPath, ...args], { cwd });
  }
  return runCheck(name, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, { cwd });
}

function runGitWorktreeClean(cwd: string): CheckResult {
  const start = performance.now();
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    }).trim();
    return createGitWorktreeCheckFromStatus(output, Math.round(performance.now() - start));
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer };
    return annotateCheck({
      name: 'Git worktree clean',
      status: 'failed',
      duration: Math.round(performance.now() - start),
      error: err.stderr?.toString().trim() || err.message,
    });
  }
}

export function createReleaseCheckCommand(getOptions: RootOptionsProvider): Command {
  return applyCommandDoc(new Command('release-check'), releaseCheckCommandDoc).action(() => {
    const options = getOptions();
    const workspaceRoot = findWorkspaceRoot(process.cwd());

    if (!workspaceRoot) {
      writeError('Could not find workspace root (pnpm-workspace.yaml)');
      process.exitCode = 1;
      return;
    }

    const checks: CheckResult[] = [];

    // 1. Git worktree state
    checks.push(runGitWorktreeClean(workspaceRoot));

    // 2. Release config integrity
    checks.push(
      runNodeScript(
        'Release config',
        resolve(workspaceRoot, 'scripts/check-release-config.mjs'),
        workspaceRoot,
      ),
    );

    // 3. Pack dry-run
    checks.push(
      runNodeScript(
        'Pack dry-run',
        resolve(workspaceRoot, 'scripts/check-npm-pack.mjs'),
        workspaceRoot,
      ),
    );

    {
      const schemaBuild = runPnpm(
        'Schema core build',
        ['--filter', '@a2amesh/runtime', 'run', 'build'],
        workspaceRoot,
      );
      checks.push(schemaBuild);

      if (schemaBuild.status === 'passed') {
        checks.push(
          runNodeScript(
            'Schema generation',
            resolve(workspaceRoot, 'scripts/generate-json-schemas.mjs'),
            workspaceRoot,
          ),
        );
      } else {
        checks.push(
          annotateCheck({
            name: 'Schema generation',
            status: 'skipped',
            duration: 0,
            error: 'Prerequisite core build failed',
          }),
        );
      }
    }

    // 5. Docs build
    checks.push(runPnpm('Docs build', ['run', 'docs:build'], workspaceRoot));

    // 6. Security audit
    checks.push(runPnpm('Security audit', ['audit', '--audit-level', 'high'], workspaceRoot));

    // 7. Public surface (declarations, command surface, names)
    checks.push(
      runNodeScript(
        'Workspace declarations',
        resolve(workspaceRoot, 'scripts/check-workspace-declarations.mjs'),
        workspaceRoot,
      ),
    );
    checks.push(
      runNodeScript(
        'Public surface',
        resolve(workspaceRoot, 'scripts/check-public-surface.mjs'),
        workspaceRoot,
      ),
    );
    checks.push(
      runNodeScript(
        'Command surface',
        resolve(workspaceRoot, 'scripts/check-command-surface.mjs'),
        workspaceRoot,
      ),
    );
    checks.push(
      runNodeScript(
        'Package names',
        resolve(workspaceRoot, 'scripts/check-package-names.mjs'),
        workspaceRoot,
      ),
    );

    // 8. Package registry parity
    checks.push(
      runNodeScript(
        'Package parity',
        resolve(workspaceRoot, 'scripts/check-package-registry-parity.mjs'),
        workspaceRoot,
      ),
    );

    // 9. Release artifact validation
    checks.push(runPnpm('Release artifacts', ['run', 'release:artifacts'], workspaceRoot));
    checks.push(
      runNodeScript(
        'Release artifact validation',
        resolve(workspaceRoot, 'scripts/validate-release-config.mjs'),
        workspaceRoot,
      ),
    );

    const report = createReleaseCheckReport(checks);

    emitResult(report, options);

    if (!report.ready) {
      process.exitCode = 1;
    }
  });
}
