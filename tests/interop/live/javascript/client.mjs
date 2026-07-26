#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  RestTransportFactory,
  createAuthenticatingFetchWithRetry,
} from '@a2a-js/sdk/client';
import { Role, taskStateToJSON } from '@a2a-js/sdk';

const sdkVersion = JSON.parse(
  await readFile(new URL('./node_modules/@a2a-js/sdk/package.json', import.meta.url), 'utf8'),
).version;
const command = process.argv[2];
const baseUrl = process.argv[3];
if (command !== 'blocking-auth' || !baseUrl) {
  console.error('Usage: client.mjs blocking-auth <base-url>');
  process.exit(64);
}

const apiKey = process.env['A2A_INTEROP_API_KEY'];
if (!apiKey) {
  console.error('A2A_INTEROP_API_KEY is required');
  process.exit(64);
}

let authenticationChallenges = 0;
let persistedHeaders = {};
const authenticatedFetch = createAuthenticatingFetchWithRetry(fetch, {
  headers: async () => persistedHeaders,
  shouldRetryWithHeaders: async (_request, response) => {
    if (response.status !== 401 && response.status !== 403) return undefined;
    authenticationChallenges += 1;
    return { 'x-a2a-api-key': apiKey };
  },
  onSuccessfulRetry: async (headers) => {
    persistedHeaders = headers;
  },
});

function buildRequest(text) {
  return {
    tenant: '',
    metadata: {},
    message: {
      messageId: randomUUID(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: 'text', value: text },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        },
      ],
      taskId: '',
      contextId: '',
      extensions: [],
      metadata: {},
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
  };
}

function readArtifactText(task) {
  return (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts ?? [])
    .filter((part) => part.content?.$case === 'text')
    .map((part) => part.content.value)
    .join('\n');
}

try {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver(),
      transports: [new RestTransportFactory({ fetchImpl: authenticatedFetch })],
      preferredTransports: ['HTTP+JSON'],
    }),
  );
  const client = await factory.createFromUrl(baseUrl);
  const sent = await client.sendMessage(buildRequest('hello from official javascript'));
  if (!sent || typeof sent !== 'object' || !('id' in sent)) {
    throw new Error('Official JavaScript client did not receive a task');
  }
  const task = await client.getTask({ tenant: '', id: sent.id, historyLength: 0 });
  process.stdout.write(
    `${JSON.stringify({
      direction: 'official-javascript-client->a2amesh-server',
      sdk: '@a2a-js/sdk',
      sdkVersion,
      protocolVersion: client.protocolVersion,
      authenticationChallenges,
      taskId: task.id,
      state: taskStateToJSON(task.status?.state),
      artifactText: readArtifactText(task),
    })}\n`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
