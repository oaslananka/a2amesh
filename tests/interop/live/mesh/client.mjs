#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { A2AClient } from '../../../../packages/runtime/dist/index.js';

const command = process.argv[2];
const baseUrl = process.argv[3];
if (!command || !baseUrl) {
  console.error('Usage: client.mjs <command> <base-url>');
  process.exit(64);
}

const protocolVersion = '1.0';
const apiKey = process.env['A2A_INTEROP_API_KEY'];

function createMessage(text) {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

function readArtifactText(task) {
  return (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

async function waitForTerminal(client, taskId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const task = await client.getTask(taskId);
    if (['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED'].includes(task.status.state)) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for task ${taskId}`);
}

function createClient(withAuthentication = false) {
  return new A2AClient(baseUrl, {
    preferredProtocolVersion: protocolVersion,
    ...(process.env['A2A_INTEROP_RPC_DIALECT'] === 'official-v1'
      ? { jsonRpcDialect: 'official-v1' }
      : {}),
    ...(withAuthentication && apiKey ? { headers: { 'x-a2a-api-key': apiKey } } : {}),
  });
}

async function runBlocking(authenticated = false) {
  const client = createClient(authenticated);
  const message = createMessage(
    authenticated ? 'hello authenticated interop' : 'hello live interop',
  );
  const initial = await client.sendMessage(message);
  const task = await waitForTerminal(client, initial.id);
  return {
    direction: 'a2amesh-client->a2amesh-server',
    protocolVersion,
    taskId: task.id,
    state: task.status.state,
    artifactText: readArtifactText(task),
  };
}

async function runStreaming() {
  const client = createClient();
  const stream = await client.sendMessageStream(createMessage('hello live stream'));
  const states = [];
  let taskId;
  let streamedArtifactText = '';
  for await (const event of stream) {
    if (!event || typeof event !== 'object') continue;

    if ('id' in event && 'status' in event && typeof event.status?.state === 'string') {
      taskId = event.id;
      states.push(event.status.state);
      streamedArtifactText ||= readArtifactText(event);
      if (['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED'].includes(event.status.state)) break;
      continue;
    }

    if ('taskId' in event && 'status' in event && typeof event.status?.state === 'string') {
      taskId = event.taskId;
      states.push(event.status.state);
      if (['COMPLETED', 'FAILED', 'CANCELED', 'REJECTED'].includes(event.status.state)) break;
      continue;
    }

    if ('taskId' in event && 'artifact' in event) {
      taskId = event.taskId;
      streamedArtifactText = (event.artifact?.parts ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
    }
  }
  if (!taskId) {
    throw new Error('Mesh stream returned no task events');
  }
  const task = await waitForTerminal(client, taskId);
  return {
    direction: 'a2amesh-client->a2amesh-server',
    protocolVersion,
    taskId: task.id,
    states,
    terminalState: task.status.state,
    artifactText: readArtifactText(task) || streamedArtifactText,
  };
}

async function runChallenge() {
  const response = await fetch(new URL('/message:send', baseUrl), {
    method: 'POST',
    headers: {
      'A2A-Version': protocolVersion,
      'Content-Type': 'application/a2a+json',
    },
    body: JSON.stringify({ message: createMessage('challenge') }),
  });
  await response.body?.cancel().catch(() => undefined);
  return {
    status: response.status,
    category: response.status === 401 ? 'authentication-required' : 'unexpected-status',
  };
}

async function runCancel() {
  const client = createClient();
  const initial = await client.sendMessage({
    message: createMessage('cancel live task'),
    configuration: { returnImmediately: true },
  });
  const task = await client.cancelTask(initial.id);
  return {
    direction: 'a2amesh-client->a2amesh-server',
    protocolVersion,
    taskId: task.id,
    state: task.status.state,
  };
}

async function runNegativeVersion() {
  const requestedVersion = '9.9';
  const response = await fetch(new URL('/a2a/jsonrpc', baseUrl), {
    method: 'POST',
    headers: {
      'A2A-Version': requestedVersion,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'live-negative-version',
      method: 'message/send',
      params: { message: createMessage('unsupported version') },
    }),
  });
  const body = await response.json().catch(() => ({}));
  const message = String(body?.error?.message ?? '').slice(0, 512);
  return {
    requestedVersion,
    status: response.status,
    category: message.includes(requestedVersion) ? 'unsupported-version' : 'unexpected-response',
    message,
  };
}

const commands = {
  blocking: () => runBlocking(false),
  'blocking-auth': () => runBlocking(true),
  streaming: runStreaming,
  challenge: runChallenge,
  cancel: runCancel,
  'negative-version': runNegativeVersion,
};

try {
  const handler = commands[command];
  if (!handler) {
    throw new Error(`Unsupported A2A Mesh live client command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(await handler())}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
