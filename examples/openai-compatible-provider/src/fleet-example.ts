import { randomUUID } from 'node:crypto';
import {
  routeFleetTask,
  StaticWorkerDirectory,
  type FleetRoutingCandidate,
  type FleetRoutingPolicy,
  type FleetRun,
  type FleetTask,
  type FleetWorker,
  type FleetWorkerDiscoveryRecord,
  type WorkerCard,
} from '@a2amesh/internal-fleet';
import type { WorkerRuntimeContext } from '@a2amesh/internal-worker-runtime';
import { OpenAICompatibleWorkerRuntimeAdapter } from '@a2amesh/internal-worker-openai-compatible';
import type { OpenAICompatibleClient, ProviderConfig } from './index.js';

const TEXT_GENERATION_CAPABILITY = 'text-generation';
const TASK_DESCRIPTION = 'Confirm OpenAI-compatible Fleet provider connectivity.';

export interface OpenAICompatibleFleetExampleResult {
  mode: 'openai-compatible-fleet-fake';
  selectedWorkerId: string;
  routedReason: string;
  runStatus: 'COMPLETED';
  verificationStatus: 'PASSED';
  artifactChecksum: string;
  providerId: string;
  model: string;
  text: string;
}

export async function runConfiguredFleetProvider(
  config: ProviderConfig,
  client: OpenAICompatibleClient,
): Promise<OpenAICompatibleFleetExampleResult> {
  const workerId = `${normalizeWorkerId(config.profile)}-worker`;
  const card = createWorkerCard(workerId);
  const directory = new StaticWorkerDirectory([createRoutingCandidate(workerId, card)]);
  const policy: FleetRoutingPolicy = {
    strategy: { type: 'CAPABILITY_MATCH' },
    requiredSignals: ['capability', 'availability', 'policy'],
  };
  const taskId = randomUUID();
  const decision = routeFleetTask(
    { taskId, requiredCapabilities: [TEXT_GENERATION_CAPABILITY] },
    await directory.listCandidates(),
    policy,
  );
  if (!decision.selectedWorkerId) {
    throw new Error(`No OpenAI-compatible Fleet worker was routed: ${decision.reason}`);
  }

  const now = new Date().toISOString();
  const task: FleetTask = {
    id: taskId,
    description: TASK_DESCRIPTION,
    status: { state: 'WORKING', timestamp: now },
    createdAt: now,
    updatedAt: now,
    targetWorkerId: decision.selectedWorkerId,
  };
  const worker: FleetWorker = {
    id: decision.selectedWorkerId,
    card,
    status: 'IDLE',
    lastSeenAt: now,
  };
  const run: FleetRun = {
    id: randomUUID(),
    taskId,
    workerId: decision.selectedWorkerId,
    status: 'RUNNING',
  };
  const context: WorkerRuntimeContext = {
    task,
    worker,
    run,
    metadata: { sideEffectLevel: 'read-only' },
  };
  const adapter = new OpenAICompatibleWorkerRuntimeAdapter({
    id: decision.selectedWorkerId,
    card,
    providerId: config.profile,
    model: config.model,
    client,
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    policy: { timeoutMs: config.timeoutMs },
  });

  const prepared = await adapter.prepare(context);
  if (prepared.type !== 'prepared') {
    throw new Error(prepared.failure?.message ?? 'Fleet provider admission failed.');
  }

  try {
    await adapter.start(context);
    for await (const event of adapter.stream(context)) {
      void event;
    }
    const result = await adapter.finalize(context, { status: 'RUNNING' });
    const verification = await adapter.verify(context);
    if (result.status !== 'COMPLETED') {
      throw new Error('Fleet provider worker did not complete successfully.');
    }
    if (verification.status !== 'PASSED') {
      throw new Error('Fleet provider worker artifact verification did not pass.');
    }
    const artifact = result.artifacts?.[0];
    const checksum = artifact?.metadata?.['checksumSha256'];
    if (!artifact || typeof checksum !== 'string') {
      throw new Error('Fleet provider worker did not produce a checksummed artifact.');
    }

    return {
      mode: 'openai-compatible-fleet-fake',
      selectedWorkerId: decision.selectedWorkerId,
      routedReason: decision.reason,
      runStatus: result.status,
      verificationStatus: verification.status,
      artifactChecksum: checksum,
      providerId: config.profile,
      model: config.model,
      text: artifact.parts
        .filter((part) => part.type === 'text')
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('\n'),
    };
  } finally {
    await adapter.cleanup(context);
  }
}

function createWorkerCard(workerId: string): WorkerCard {
  return {
    protocolVersion: '1.0',
    name: workerId,
    description: 'Read-only text inference through an official OpenAI-compatible API.',
    url: `http://127.0.0.1:0/${workerId}`,
    version: '1.0.0',
    fleetRoles: ['model-worker'],
    maxConcurrentTasks: 1,
  };
}

function createRoutingCandidate(workerId: string, card: WorkerCard): FleetRoutingCandidate {
  const now = new Date().toISOString();
  const discovery: FleetWorkerDiscoveryRecord = {
    workerId,
    card,
    discoveredAt: now,
    lastHeartbeatAt: now,
    status: 'IDLE',
    capabilities: [TEXT_GENERATION_CAPABILITY],
    roles: card.fleetRoles ?? [],
  };
  return { worker: discovery, activeRunCount: 0, maxConcurrentTasks: 1 };
}

function normalizeWorkerId(profile: string): string {
  const segments: string[] = [];
  let separatorPending = false;
  for (const character of profile.toLowerCase()) {
    const code = character.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (isAsciiLetter || isDigit) {
      if (separatorPending && segments.length > 0) segments.push('-');
      segments.push(character);
      separatorPending = false;
    } else if (segments.length > 0) {
      separatorPending = true;
    }
  }
  return segments.join('') || 'openai-compatible';
}
