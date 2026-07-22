#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { A2AServer } from '../packages/runtime/dist/index.js';
import { RegistryServer } from '../packages/registry/dist/index.js';

const VALID_PROFILES = new Set(['smoke', 'load']);
const profile = readProfile(process.argv);

class PerformanceAgentServer extends A2AServer {
  async handleTask(task, message) {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ');

    return [
      {
        artifactId: `perf-artifact-${task.id}`,
        name: 'echo',
        parts: [{ type: 'text', text: text || 'ok' }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}

const agentCard = {
  protocolVersion: '1.0',
  name: 'A2A Mesh Performance Agent',
  description: 'Local deterministic performance smoke agent.',
  url: 'http://127.0.0.1:0',
  version: '1.0.0',
  capabilities: {
    streaming: false,
    stateTransitionHistory: true,
  },
  skills: [
    {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes text payloads for local performance smoke checks.',
      tags: ['echo', 'performance'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    },
  ],
};

let agentServer;
let registryServer;

try {
  agentServer = new PerformanceAgentServer(agentCard, {
    rateLimit: { windowMs: 60_000, max: profile === 'load' ? 10_000 : 1_000 },
  });
  const agentHttpServer = agentServer.start(0);
  const agentBaseUrl = await waitForListening(agentHttpServer);
  agentCard.url = agentBaseUrl;

  registryServer = new RegistryServer({
    allowLocalhost: true,
    allowPrivateNetworks: true,
    healthPollingIntervalMs: 60_000,
    taskPollingIntervalMs: 60_000,
    healthyRecheckIntervalMs: 100,
    unknownRecheckIntervalMs: 100,
    unhealthyRecheckIntervalMs: 250,
    taskPollCooldownMs: 100,
    healthCheckConcurrency: 4,
    taskPollingConcurrency: 4,
  });
  const registryHttpServer = registryServer.start(0);
  const registryBaseUrl = await waitForListening(registryHttpServer);

  await seedServerTasks(agentBaseUrl);
  await seedRegistry(registryBaseUrl, agentBaseUrl);
  await refreshRegistryTaskProjection(registryBaseUrl);

  await runK6(resolve('tests/performance/k6/server.js'), {
    A2A_SERVER_URL: agentBaseUrl,
  });
  await runK6(resolve('tests/performance/k6/registry.js'), {
    A2A_REGISTRY_URL: registryBaseUrl,
    PERF_EXPECTED_AGENTS: '4',
  });
} finally {
  await registryServer?.stop();
  await agentServer?.stop();
}

function readProfile(argv) {
  const profileIndex = argv.indexOf('--profile');
  const value = profileIndex === -1 ? 'smoke' : argv[profileIndex + 1];
  if (!VALID_PROFILES.has(value)) {
    throw new Error(`Unknown performance profile: ${value ?? '<missing>'}`);
  }
  return value;
}

async function waitForListening(server) {
  if (!server.listening) {
    await once(server, 'listening');
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve local server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function seedServerTasks(baseUrl) {
  for (let index = 0; index < 3; index += 1) {
    await postJsonRpc(baseUrl, {
      jsonrpc: '2.0',
      id: `seed-${index}`,
      method: 'message/send',
      params: {
        message: createMessage(`seed task ${index}`),
        configuration: { blocking: true },
      },
    });
  }
}

async function seedRegistry(registryBaseUrl, agentBaseUrl) {
  for (let index = 0; index < 4; index += 1) {
    const response = await fetch(`${registryBaseUrl}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentUrl: agentBaseUrl,
        isPublic: true,
        agentCard: {
          ...agentCard,
          name: `A2A Mesh Performance Agent ${index + 1}`,
          skills: agentCard.skills.map((skill) => ({
            ...skill,
            id: `${skill.id}-${index + 1}`,
          })),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to seed registry agent ${index + 1}: ${response.status}`);
    }
  }
}

async function refreshRegistryTaskProjection(registryBaseUrl) {
  const response = await fetch(`${registryBaseUrl}/tasks/recent?limit=5`);
  if (!response.ok) {
    throw new Error(`Failed to prime registry task polling: ${response.status}`);
  }
}

async function postJsonRpc(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Seed JSON-RPC request failed: ${response.status}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`Seed JSON-RPC request returned error: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

function createMessage(text) {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: `perf-${randomUUID()}`,
    timestamp: new Date().toISOString(),
  };
}

async function runK6(scriptPath, extraEnv) {
  const child = spawn(process.env.K6_BIN ?? 'k6', ['run', scriptPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PERF_PROFILE: profile,
      ...extraEnv,
    },
  });

  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(
      `k6 ${profile} run failed for ${scriptPath} with ${signal ? `signal ${signal}` : `status ${code}`}`,
    );
  }
}
