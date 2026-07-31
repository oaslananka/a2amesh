#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOpenClawMcpBridge, createOpenClawMcpHttpApp } from './bridge.js';
import { loadOpenClawMcpRuntimeConfig } from './config.js';

async function start(): Promise<void> {
  const config = loadOpenClawMcpRuntimeConfig(process.env);
  if (config.transport === 'stdio') {
    const bridge = createOpenClawMcpBridge(config.bridgeOptions);
    const transport = new StdioServerTransport();
    await bridge.server.connect(transport as never);
    console.error('A2A Mesh OpenClaw MCP compatibility server ready on stdio.');
    return;
  }

  const transportToken = config.transportToken;
  if (!transportToken) throw new Error('Streamable HTTP transport token is missing.');
  const app = createOpenClawMcpHttpApp({
    ...config.bridgeOptions,
    host: config.host,
    transportToken,
  });
  const listener = app.listen(config.port, config.host, () => {
    console.error(
      `A2A Mesh OpenClaw MCP compatibility server ready at http://${config.host}:${config.port}/mcp.`,
    );
  });

  const shutdown = (): void => {
    listener.close((error) => {
      if (error) console.error('OpenClaw MCP compatibility server shutdown failed.');
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'OpenClaw MCP server failed.');
  process.exitCode = 1;
});
