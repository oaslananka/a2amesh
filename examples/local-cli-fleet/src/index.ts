import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  routeFleetTask,
  StaticWorkerDirectory,
  type FleetProviderWorkerPlan,
  type FleetRoutingCandidate,
  type FleetRoutingPolicy,
  type FleetRun,
  type FleetTask,
  type FleetWorker,
  type FleetWorkerDiscoveryRecord,
  type WorkerCard,
} from '@a2amesh/internal-fleet';
import {
  LocalCliWorkerRuntimeAdapter,
  type WorkerRuntimeContext,
} from '@a2amesh/internal-worker-runtime';

/**
 * Experimental example (alpha): wires a generic local CLI coding agent in as
 * an A2A Mesh Fleet worker. This is the *pattern*, not a shipped integration
 * with any specific CLI - see "Using a real coding CLI" in the README for how
 * an operator points `A2AMESH_CLI_FLEET_COMMAND` at their own coding CLI
 * (for example `opencode` or Google's `agy`). Nothing here executes an
 * external CLI in the default/tested path: the demo and smoke test only ever
 * run a bundled `node` stand-in, so this never depends on an external
 * binary or provider credentials being present.
 */

const CODE_EDIT_CAPABILITY = 'code-edit';

const localCliCoderPlan: FleetProviderWorkerPlan = {
  providerId: 'local-cli-coder',
  workerRole: 'code-editor',
  supportStatus: 'experimental',
  allowedSurfaces: ['official-cli', 'artifact-handoff', 'git-worktree'],
  forbiddenSurfaces: [
    'browser-session',
    'web-ui-scraping',
    'token-extraction',
    'subscription-bypass',
    'private-endpoint',
  ],
  capabilities: [CODE_EDIT_CAPABILITY, 'patch-generation'],
  credentialPolicy: 'env-ref',
  notes:
    'Point A2AMESH_CLI_FLEET_COMMAND at a local coding CLI. Provider keys are ' +
    'never inlined here - set A2AMESH_CLI_FLEET_API_KEY_ENV to the name of an ' +
    'environment variable that already holds one.',
};

export interface LocalCliFleetExampleResult {
  mode: 'local-cli-fleet';
  selectedWorkerId: string;
  routedReason: string;
  runStatus: string;
  artifactName: string | undefined;
  artifactChecksum: string | undefined;
  plan: FleetProviderWorkerPlan;
}

function createWorkerCard(id: string): WorkerCard {
  return {
    protocolVersion: '1.0',
    name: id,
    description: 'Generic local CLI coding agent wrapped as a Fleet worker (experimental).',
    url: 'local-cli://' + id,
    version: '1.0.0',
    fleetRoles: ['code-editor'],
    maxConcurrentTasks: 1,
  };
}

function createDiscoveryRecord(card: WorkerCard): FleetWorkerDiscoveryRecord {
  const now = new Date().toISOString();
  return {
    workerId: card.name,
    card,
    discoveredAt: now,
    lastHeartbeatAt: now,
    status: 'IDLE',
    capabilities: [CODE_EDIT_CAPABILITY, 'patch-generation'],
    roles: card.fleetRoles ?? [],
  };
}

/** Builds the inline `node -e` script the CI-safe stand-in command runs. */
function buildStandInScript(taskDescription: string): string {
  const description = JSON.stringify(taskDescription);
  return [
    "const fs = require('node:fs');",
    `fs.writeFileSync('out.patch', 'diff --git a/example.txt b/example.txt\\n+// handled: ' + ${description} + '\\n');`,
    `console.log('local CLI worker completed: ' + ${description});`,
  ].join(' ');
}

export async function runExample(): Promise<LocalCliFleetExampleResult> {
  const command = process.env['A2AMESH_CLI_FLEET_COMMAND'] ?? 'node';
  const apiKeyEnvName = process.env['A2AMESH_CLI_FLEET_API_KEY_ENV'];
  const workspaceRoot =
    process.env['A2AMESH_CLI_FLEET_WORKSPACE'] ??
    mkdtempSync(join(tmpdir(), 'a2amesh-local-cli-fleet-'));

  const card = createWorkerCard('local-cli-coder-1');
  const candidates: FleetRoutingCandidate[] = [
    {
      worker: createDiscoveryRecord(card),
      activeRunCount: 0,
      ...(card.maxConcurrentTasks !== undefined
        ? { maxConcurrentTasks: card.maxConcurrentTasks }
        : {}),
    },
  ];
  const directory = new StaticWorkerDirectory(candidates);

  const policy: FleetRoutingPolicy = {
    strategy: { type: 'CAPABILITY_MATCH' },
    requiredSignals: ['capability', 'availability', 'policy'],
  };

  const taskId = randomUUID();
  const taskDescription = 'Add a short patch demonstrating the local CLI fleet worker.';

  const decision = routeFleetTask(
    { taskId, requiredCapabilities: [CODE_EDIT_CAPABILITY] },
    await directory.listCandidates(),
    policy,
  );
  if (!decision.selectedWorkerId) {
    throw new Error(`No worker was routed for the task: ${decision.reason}`);
  }
  const selectedWorkerId = decision.selectedWorkerId;

  const adapter = new LocalCliWorkerRuntimeAdapter({
    id: selectedWorkerId,
    card,
    command,
    buildArgs: (context) => ['-e', buildStandInScript(context.task.description ?? context.task.id)],
    artifactFiles: () => ['out.patch'],
    ...(apiKeyEnvName ? { env: { [apiKeyEnvName]: process.env[apiKeyEnvName] ?? '' } } : {}),
    policy: {
      commandAllowlist: [command],
      workspaceRoot,
      envAllowlist: apiKeyEnvName ? [apiKeyEnvName] : [],
    },
  });

  const now = new Date().toISOString();
  const task: FleetTask = {
    id: taskId,
    description: taskDescription,
    status: { state: 'WORKING', timestamp: now },
    createdAt: now,
    updatedAt: now,
    targetWorkerId: selectedWorkerId,
  };
  const worker: FleetWorker = {
    id: selectedWorkerId,
    card,
    status: 'IDLE',
    lastSeenAt: now,
  };
  const run: FleetRun = {
    id: randomUUID(),
    taskId,
    workerId: selectedWorkerId,
    status: 'RUNNING',
  };
  const context: WorkerRuntimeContext = { task, worker, run };

  await adapter.start(context);
  for await (const event of adapter.stream(context)) {
    // The demo does not need to inspect individual streamed events; the
    // adapter's own test suite covers the event sequence in isolation.
    void event;
  }
  const result = await adapter.finalize(context, { status: 'RUNNING' });

  return {
    mode: 'local-cli-fleet',
    selectedWorkerId,
    routedReason: decision.reason,
    runStatus: result.status,
    artifactName: result.artifacts?.[0]?.name,
    artifactChecksum: result.artifacts?.[0]?.metadata?.['checksumSha256'] as string | undefined,
    plan: localCliCoderPlan,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runExample()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
