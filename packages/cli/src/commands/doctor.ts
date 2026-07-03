import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { emitResult, type RootOptionsProvider } from '../io.js';
import { getLocalReleaseGates, type LocalReleaseGate } from '../release-gates.js';
import { CLI_VERSION } from '../version.js';
import { findWorkspaceRoot } from '../workspace.js';
import { applyCommandDoc, type CliCommandDoc } from './doc-metadata.js';

export const doctorCommandDoc = {
  path: ['doctor'],
  summary: 'Print local CLI diagnostics.',
  description:
    'Prints local CLI diagnostics including CLI version, Node.js version, current platform, workspace detection, package-manager hints, and local release-gate coverage.',
  examples: [
    {
      title: 'Print diagnostics as JSON.',
      bash: ['a2amesh doctor --json --release-gates'],
      powershell: ['a2amesh doctor --json --release-gates'],
    },
  ],
} satisfies CliCommandDoc;

interface DoctorCommandOptions {
  releaseGates?: boolean;
}

interface DoctorCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  message: string;
  remediation?: string;
}

interface DoctorReport {
  cli: 'a2amesh';
  version: string;
  node: string;
  platform: NodeJS.Platform;
  workspaceRoot: string | undefined;
  packageManager: string | undefined;
  checks: DoctorCheck[];
  releaseGates?: readonly LocalReleaseGate[];
}

function readPackageManager(workspaceRoot: string | undefined): string | undefined {
  if (!workspaceRoot) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')) as {
      packageManager?: string;
    };
    return pkg.packageManager;
  } catch {
    return undefined;
  }
}

function nodeCheck(): DoctorCheck {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22 && major < 25) {
    return { name: 'Node.js version', status: 'passed', message: process.version };
  }
  return {
    name: 'Node.js version',
    status: 'failed',
    message: `${process.version} is outside the supported release range.`,
    remediation: 'Use Node.js >=22.22.1 and <25 before running local release gates.',
  };
}

export function createDoctorReport(options: DoctorCommandOptions = {}): DoctorReport {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const packageManager = readPackageManager(workspaceRoot);
  const checks: DoctorCheck[] = [nodeCheck()];

  checks.push(
    workspaceRoot
      ? { name: 'Workspace root', status: 'passed', message: workspaceRoot }
      : {
          name: 'Workspace root',
          status: 'failed',
          message: 'pnpm-workspace.yaml was not found from the current directory.',
          remediation: 'Run a2amesh doctor from inside the repository checkout.',
        },
  );

  checks.push(
    packageManager?.startsWith('pnpm@')
      ? { name: 'Package manager', status: 'passed', message: packageManager }
      : {
          name: 'Package manager',
          status: 'warning',
          message: packageManager ?? 'packageManager field unavailable',
          remediation: 'Use the workspace packageManager pin before running release-check.',
        },
  );

  return {
    cli: 'a2amesh',
    version: CLI_VERSION,
    node: process.version,
    platform: process.platform,
    workspaceRoot,
    packageManager,
    checks,
    ...(options.releaseGates ? { releaseGates: getLocalReleaseGates() } : {}),
  };
}

export function createDoctorCommand(getOptions: RootOptionsProvider): Command {
  return applyCommandDoc(new Command('doctor'), doctorCommandDoc)
    .option('--release-gates', 'Include local release gate commands and matching CI signals')
    .action((commandOptions: DoctorCommandOptions) => {
      emitResult(createDoctorReport(commandOptions), getOptions());
    });
}
