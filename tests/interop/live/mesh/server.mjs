#!/usr/bin/env node
import { A2AServer } from '../../../../packages/runtime/dist/index.js';

const mode = process.argv[2] ?? 'complete';
const allowedModes = new Set(['complete', 'cancellable', 'authenticated']);
if (!allowedModes.has(mode)) {
  console.error(`Unsupported A2A Mesh live server mode: ${mode}`);
  process.exit(64);
}

const apiKey = process.env['A2A_INTEROP_API_KEY'] ?? 'mesh-live-key';
const port = Number(process.env['A2A_INTEROP_PORT'] ?? '0');

function readMessageText(message) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

function waitForCancellation(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 30_000);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('task canceled'));
      },
      { once: true },
    );
  });
}

class LiveMeshServer extends A2AServer {
  constructor(serverMode) {
    const authenticated = serverMode === 'authenticated';
    const securityScheme = {
      id: 'interop-api-key',
      type: 'apiKey',
      in: 'header',
      name: 'x-a2a-api-key',
    };
    super(
      {
        protocolVersion: '1.0',
        name: `A2A Mesh live ${serverMode} server`,
        description: 'Loopback-only live interoperability participant.',
        url: 'http://127.0.0.1:0',
        version: '0.12.0-alpha.1',
        capabilities: {
          streaming: true,
          pushNotifications: false,
          stateTransitionHistory: true,
        },
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        ...(authenticated
          ? {
              securitySchemes: [securityScheme],
              security: [{ 'interop-api-key': [] }],
            }
          : {}),
      },
      {
        allowLocalhost: true,
        rateLimit: { maxRequests: 1_000 },
        ...(authenticated
          ? {
              auth: {
                securitySchemes: [securityScheme],
                apiKeys: {
                  'interop-api-key': {
                    value: apiKey,
                    principalId: 'live-interop-user',
                    tenantId: 'live-interop',
                    scopes: ['tasks:read', 'tasks:write'],
                  },
                },
              },
            }
          : {}),
      },
    );
    this.serverMode = serverMode;
  }

  async handleTask(_task, message, signal) {
    if (this.serverMode === 'cancellable') {
      await waitForCancellation(signal);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return [
      {
        artifactId: 'mesh-live-artifact',
        name: 'Mesh live artifact',
        parts: [{ type: 'text', text: `mesh:${readMessageText(message)}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

const agent = new LiveMeshServer(mode);
const listener = agent.start(port);

async function getBaseUrl() {
  if (!listener.listening) {
    await new Promise((resolve, reject) => {
      listener.once('listening', resolve);
      listener.once('error', reject);
    });
  }
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve A2A Mesh live server port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function shutdown() {
  await agent.stop();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

try {
  const url = await getBaseUrl();
  const card = agent.getAgentCard();
  card.url = url;
  card.supportedInterfaces = [
    {
      url: `${url}/a2a/jsonrpc`,
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    },
    {
      url,
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
    },
  ];
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', participant: 'a2amesh-server', mode, url })}\n`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
