#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createA2AMcpBridge, createA2AMcpHttpApp } from './bridge.js';
import { loadA2AMcpRuntimeConfig } from './config.js';

export type A2AMcpServerCommand =
  | { action: 'help' }
  | { action: 'version' }
  | { action: 'start'; transport?: 'stdio' | 'streamable-http' };

export interface A2AMcpServerOutput {
  write(value: string): unknown;
}

type A2AMcpPackageReader = (path: URL, encoding: 'utf8') => string;

export interface A2AMcpServerCliOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  output?: A2AMcpServerOutput;
  errorOutput?: (message: string) => void;
  setExitCode?: (code: number) => void;
  runCommand?: typeof runA2AMcpServerCommand;
}

export function parseA2AMcpServerArgs(args: string[]): A2AMcpServerCommand {
  if (args.includes('--help') || args.includes('-h')) return { action: 'help' };
  if (args.includes('--version') || args.includes('-v')) return { action: 'version' };
  if (args.length === 0) return { action: 'start' };
  if (args.length === 2 && args[0] === '--transport') {
    const transport = args[1];
    if (transport === 'stdio' || transport === 'streamable-http') {
      return { action: 'start', transport };
    }
    throw new Error('--transport must be stdio or streamable-http.');
  }
  throw new Error('Unknown arguments. Run a2amesh-mcp --help.');
}

export function renderA2AMcpServerHelp(): string {
  return [
    'Usage: a2amesh-mcp [--transport stdio|streamable-http]',
    '',
    'Starts the security-bounded A2A Mesh MCP server.',
    'Configuration is read from A2AMESH_MCP_* environment variables.',
    'Run with --version to print the installed package version.',
  ].join('\n');
}

export function readA2AMcpPackageVersion(readPackage: A2AMcpPackageReader = readFileSync): string {
  const packageJson = JSON.parse(
    readPackage(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };
  if (!packageJson.version) throw new Error('Package version is unavailable.');
  return packageJson.version;
}

export async function startA2AMcpServer(
  env: NodeJS.ProcessEnv,
  command: Extract<A2AMcpServerCommand, { action: 'start' }>,
): Promise<void> {
  const version = readA2AMcpPackageVersion();
  const config = loadA2AMcpRuntimeConfig(env, {
    ...(command.transport ? { transport: command.transport } : {}),
    serverVersion: version,
  });
  if (config.transport === 'stdio') {
    const bridge = createA2AMcpBridge(config.bridgeOptions);
    const transport = new StdioServerTransport();
    await bridge.server.connect(transport as never);
    console.error('A2A Mesh MCP server ready on stdio.');
    return;
  }

  const transportToken = config.transportToken;
  if (!transportToken) throw new Error('Streamable HTTP transport token is missing.');
  const app = createA2AMcpHttpApp({
    ...config.bridgeOptions,
    host: config.host,
    transportToken,
  });
  const listener = app.listen(config.port, config.host, () => {
    console.error(`A2A Mesh MCP server ready at http://${config.host}:${config.port}/mcp.`);
  });
  const shutdown = (): void => {
    listener.close((error) => {
      if (error) console.error('A2A Mesh MCP server shutdown failed.');
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

export async function runA2AMcpServerCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  output: A2AMcpServerOutput = process.stdout,
): Promise<void> {
  const command = parseA2AMcpServerArgs(args);
  if (command.action === 'help') {
    output.write(`${renderA2AMcpServerHelp()}\n`);
    return;
  }
  if (command.action === 'version') {
    output.write(`${readA2AMcpPackageVersion()}\n`);
    return;
  }
  await startA2AMcpServer(env, command);
}

export async function runA2AMcpServerCli(options: A2AMcpServerCliOptions = {}): Promise<void> {
  const {
    args = process.argv.slice(2),
    env = process.env,
    output = process.stdout,
    errorOutput = console.error,
    setExitCode = (code: number): void => {
      process.exitCode = code;
    },
    runCommand = runA2AMcpServerCommand,
  } = options;

  try {
    await runCommand(args, env, output);
  } catch (error: unknown) {
    errorOutput(error instanceof Error ? error.message : 'A2A Mesh MCP server failed.');
    setExitCode(1);
  }
}

export function startA2AMcpServerCliIfEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
  runCli: () => Promise<void> = runA2AMcpServerCli,
): boolean {
  if (!argv[1]) return false;
  let invokedUrl: string;
  let canonicalModuleUrl: string;
  try {
    invokedUrl = pathToFileURL(realpathSync(resolve(argv[1]))).href;
    canonicalModuleUrl = pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href;
  } catch {
    return false;
  }
  if (invokedUrl !== canonicalModuleUrl) return false;
  void runCli();
  return true;
}

startA2AMcpServerCliIfEntrypoint();
