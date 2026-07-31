import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { OpenClawMcpBridge, OpenClawMcpHttpOptions } from './types.js';

function equalToken(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(actual.slice('Bearer '.length));
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export function createOpenClawMcpHttpAppWithFactory(
  options: OpenClawMcpHttpOptions,
  createBridge: (options: OpenClawMcpHttpOptions) => OpenClawMcpBridge,
): ReturnType<typeof createMcpExpressApp> {
  if (!options.transportToken.trim()) {
    throw new Error('A non-empty Streamable HTTP transport token is required.');
  }
  const app = createMcpExpressApp({
    host: options.host ?? '127.0.0.1',
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
  });

  app.use('/mcp', (request, response, next) => {
    if (!equalToken(request.header('authorization'), options.transportToken)) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

  app.post('/mcp', async (request, response) => {
    const bridge = createBridge(options);
    const transport = new StreamableHTTPServerTransport();
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      void Promise.allSettled([transport.close(), bridge.server.close()]);
    };
    response.once('close', cleanup);

    try {
      await bridge.server.connect(transport as never);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    } finally {
      if (response.writableEnded || response.destroyed) cleanup();
    }
  });

  app.get('/mcp', (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });
  app.delete('/mcp', (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });
  return app;
}
