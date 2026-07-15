import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBenchmarkCommand } from '../src/commands/benchmark.js';
import { createConformanceCommand } from '../src/commands/conformance.js';
import { createDiscoverCommand } from '../src/commands/discover.js';
import { createExportCardCommand } from '../src/commands/export-card.js';
import { createHealthCommand } from '../src/commands/health.js';
import { createMonitorCommand } from '../src/commands/monitor.js';
import { createRegistryCommand } from '../src/commands/registry.js';
import { createSendCommand } from '../src/commands/send.js';
import { createTaskCommand } from '../src/commands/task.js';
import { createValidateCommand } from '../src/commands/validate.js';
import { runCli } from '../src/index.js';
import { expectCommandHelp, jsonOptions } from './command-test-helpers.js';

const sharedOptionSnippets = [
  '--header <key:value...>',
  '--bearer-token <token>',
  '--api-key <name:value>',
  '--timeout-ms <ms>',
  '--retries <count>',
  '--request-id <id>',
  '--origin <url>',
  '--allow-private-network',
];

describe('network command option surface', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('adds shared network options to top-level network commands', () => {
    const commands = [
      createDiscoverCommand(jsonOptions),
      createSendCommand(jsonOptions),
      createHealthCommand(jsonOptions),
      createValidateCommand(jsonOptions),
      createMonitorCommand(jsonOptions),
      createBenchmarkCommand(jsonOptions),
      createExportCardCommand(jsonOptions),
      createConformanceCommand(jsonOptions),
    ];

    for (const command of commands) {
      expectCommandHelp(command, sharedOptionSnippets);
    }
  });

  it('adds shared network options to task and registry network subcommands', () => {
    const taskCommand = createTaskCommand(jsonOptions);
    const registryCommand = createRegistryCommand(jsonOptions);

    for (const name of ['send', 'stream', 'status', 'cancel']) {
      const subcommand = taskCommand.commands.find((command) => command.name() === name);
      expect(subcommand, name).toBeDefined();
      expectCommandHelp(subcommand!, sharedOptionSnippets);
    }

    const registryList = registryCommand.commands.find((command) => command.name() === 'list');
    const registryExport = registryCommand.commands.find((command) => command.name() === 'export');
    const registryImport = registryCommand.commands.find((command) => command.name() === 'import');
    const registryStart = registryCommand.commands.find((command) => command.name() === 'start');
    expect(registryList).toBeDefined();
    expect(registryExport).toBeDefined();
    expect(registryImport).toBeDefined();
    expect(registryStart).toBeDefined();
    expectCommandHelp(registryList!, sharedOptionSnippets);
    expectCommandHelp(registryExport!, sharedOptionSnippets);
    expectCommandHelp(registryImport!, sharedOptionSnippets);
    expect(registryStart!.helpInformation()).not.toContain('--bearer-token');
  });

  it('returns exit code 1 for invalid shared header syntax without printing the value', async () => {
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });

    await runCli([
      'node',
      'a2amesh',
      '--json',
      'health',
      'http://127.0.0.1:3000',
      '--header',
      'Authorization bearer-secret',
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('Invalid --header syntax. Expected <key:value>.');
    expect(stderr).not.toContain('bearer-secret');
  });
});
