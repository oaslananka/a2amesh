import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  DiscoverRequestSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/core';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';

const PROTOCOL_VERSION = '2026-07-28';
const TEST_CREDENTIAL = ['fixture', 'credential'].join('-');
const EXPECTED_AUTH_HEADER = ['Bearer', TEST_CREDENTIAL].join(' ');

export async function runProbe() {
  const requests = [];
  const handler = createMcpHandler(() => createServerInstance(), { legacy: 'reject' });
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const httpServer = createServer(async (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    if (request.headers.authorization !== EXPECTED_AUTH_HEADER) {
      response.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="mcp-next-probe"',
      });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    request.auth = {
      token: TEST_CREDENTIAL,
      clientId: 'a2amesh-compat-client',
      scopes: ['mcp:tools'],
    };
    const bodyText = await readBody(request);
    const body = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      requests.push(toRequestEvidence(request, body));
    }
    await nodeHandler(request, response, body);
  });

  let client;
  try {
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('Probe server address unavailable');
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);

    const unauthorizedStatus = await sendUnauthorizedProbe(url);
    client = new Client(
      { name: 'a2amesh-compat-client', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: PROTOCOL_VERSION } } },
    );
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: { token: async () => TEST_CREDENTIAL },
    });
    await client.connect(transport);

    const toolsResult = ListToolsResultSchema.parse(await client.listTools());
    const callResult = CallToolResultSchema.parse(
      await client.callTool({ name: 'research-agent', arguments: {} }),
    );
    for (const request of requests) {
      if (request.method === 'server/discover') DiscoverRequestSchema.parse(request.body);
      if (request.method === 'tools/call') CallToolRequestSchema.parse(request.body);
    }

    const text = callResult.content.find((item) => item.type === 'text')?.text;
    return {
      sdk: readSdkVersions(),
      protocolVersion: transport.protocolVersion,
      unauthorizedStatus,
      methods: requests.map((request) => request.method).filter(Boolean),
      sawInitialize: requests.some((request) => request.method === 'initialize'),
      tools: {
        names: toolsResult.tools.map((tool) => tool.name),
        ttlMs: toolsResult.ttlMs,
        cacheScope: toolsResult.cacheScope,
      },
      call: { text },
      requests: requests.map(({ body: _body, ...request }) => request),
    };
  } finally {
    await client?.close().catch(() => undefined);
    await handler.close().catch(() => undefined);
    if (httpServer.listening) {
      httpServer.close();
      await once(httpServer, 'close');
    }
  }
}

function createServerInstance() {
  const server = new McpServer(
    { name: 'a2amesh-compat-server', version: '0.0.0' },
    {
      supportedProtocolVersions: [PROTOCOL_VERSION],
      capabilities: { tools: {} },
      cacheHints: {
        'server/discover': { ttlMs: 60_000, cacheScope: 'public' },
        'tools/list': { ttlMs: 120_000, cacheScope: 'public' },
      },
    },
  );
  server.registerTool(
    'research-agent',
    { description: 'Returns deterministic compatibility evidence.' },
    async () => ({ content: [{ type: 'text', text: 'fixture-ok' }] }),
  );
  server.registerTool(
    'summary-agent',
    { description: 'Returns deterministic compatibility evidence.' },
    async () => ({ content: [{ type: 'text', text: 'summary-ok' }] }),
  );
  return server;
}

async function sendUnauthorizedProbe(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'unauthorized-probe',
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '0.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  await response.arrayBuffer();
  return response.status;
}

function toRequestEvidence(request, body) {
  return {
    body,
    protocolVersion: headerValue(request.headers['mcp-protocol-version']),
    methodHeader: headerValue(request.headers['mcp-method']),
    nameHeader: headerValue(request.headers['mcp-name']),
    method: typeof body.method === 'string' ? body.method : undefined,
    name: typeof body.params?.name === 'string' ? body.params.name : undefined,
    hasCredential: request.headers.authorization === EXPECTED_AUTH_HEADER,
  };
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body;
}

function readSdkVersions() {
  return {
    client: readPackageVersion('@modelcontextprotocol/client'),
    core: readPackageVersion('@modelcontextprotocol/core'),
    node: readPackageVersion('@modelcontextprotocol/node'),
    server: readPackageVersion('@modelcontextprotocol/server'),
  };
}

function readPackageVersion(packageName) {
  const entry = import.meta.resolve(packageName);
  const packageUrl = new URL('../package.json', entry);
  return JSON.parse(readFileSync(packageUrl, 'utf8')).version;
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  const result = await runProbe();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
