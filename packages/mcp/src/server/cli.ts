#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createA2AMcpBridge, createA2AMcpHttpApp } from './bridge.js';
import { loadA2AMcpRuntimeConfig } from './config.js';

export type A2AMcpServerCommand =
  | { action: 'help' }
  | { action: 'version' }
  | { action: 'start'; transport?: 'stdio' | 'streamable-http' };

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

function packageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };
  if (!packageJson.version) throw new Error('Package version is unavailable.');
  return packageJson.version;
}

export async function startA2AMcpServer(
  env: NodeJS.ProcessEnv,
  command: Extract<A2AMcpServerCommand, { action: 'start' }>,
): Promise<void> {
  const version = packageVersion();
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

async function main(): Promise<void> {
  const command = parseA2AMcpServerArgs(process.argv.slice(2));
  if (command.action === 'help') {
    process.stdout.write(`${renderA2AMcpServerHelp()}\n`);
    return;
  }
  if (command.action === 'version') {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  await startA2AMcpServer(process.env, command);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'A2A Mesh MCP server failed.');
    process.exitCode = 1;
  });
}
