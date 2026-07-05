#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { createBenchmarkCommand } from './commands/benchmark.js';
import { createConformanceBadgeCommand } from './commands/conformance-badge.js';
import { createConformanceCommand } from './commands/conformance.js';
import { createDiscoverCommand } from './commands/discover.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createExportCardCommand } from './commands/export-card.js';
import { createHealthCommand } from './commands/health.js';
import { createMonitorCommand } from './commands/monitor.js';
import { createRegistryCommand } from './commands/registry.js';
import { createReleaseCheckCommand } from './commands/release-check.js';
import { createReplayCommand } from './commands/replay.js';
import { createScaffoldCommand } from './commands/scaffold.js';
import { createSendCommand } from './commands/send.js';
import { createTaskCommand } from './commands/task.js';
import { createValidateCommand } from './commands/validate.js';
import { writeError, type CliOptions } from './io.js';
import { CLI_VERSION } from './version.js';

export { cliCommandDocs, commandDocKey, type CliCommandDoc } from './commands/docs.js';

export function createProgram(): Command {
  const program = new Command();
  const getOptions = (): CliOptions => program.opts<CliOptions>();

  program
    .name('a2amesh')
    .version(CLI_VERSION)
    .description('A2A Mesh developer CLI')
    .option('--json', 'Machine-readable JSON output');

  program.addCommand(createDiscoverCommand(getOptions));
  program.addCommand(createScaffoldCommand());
  program.addCommand(createTaskCommand(getOptions));
  program.addCommand(createSendCommand(getOptions));
  program.addCommand(createRegistryCommand(getOptions));
  program.addCommand(createHealthCommand(getOptions));
  program.addCommand(createValidateCommand(getOptions));
  program.addCommand(createMonitorCommand(getOptions));
  program.addCommand(createBenchmarkCommand(getOptions));
  program.addCommand(createConformanceBadgeCommand(getOptions));
  program.addCommand(createConformanceCommand(getOptions));
  program.addCommand(createDoctorCommand(getOptions));
  program.addCommand(createReleaseCheckCommand(getOptions));
  program.addCommand(createExportCardCommand(getOptions));
  program.addCommand(createReplayCommand(getOptions));

  return program;
}

function normalizeScriptArgv(argv: string[]): string[] {
  if (argv[2] !== '--') return argv;
  return [argv[0] ?? '', argv[1] ?? '', ...argv.slice(3)];
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(normalizeScriptArgv(argv)).catch((error: unknown) => {
    writeError(`CLI failed: ${String(error)}`);
    process.exitCode = 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli();
}
