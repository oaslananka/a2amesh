#!/usr/bin/env node

const { runA2AMcpServerCli } = await import('../dist/server/cli.js');
await runA2AMcpServerCli();
