import { describe, expect, it } from 'vitest';
import type {
  A2AHealthResponse,
  AgentCard,
  PushNotificationConfig,
  Task,
  TaskListParams,
  TaskListResult,
  TaskState,
} from '@a2amesh/runtime';

const TERMINAL_STATES = new Set<TaskState>(['COMPLETED', 'FAILED', 'CANCELED']);

const transportOperationNames = [
  'sendMessage',
  'streamMessage',
  'getTask',
  'listTasks',
  'cancelTask',
  'resubscribeTask',
  'createPushNotificationConfig',
  'getPushNotificationConfig',
  'listPushNotificationConfigs',
  'deletePushNotificationConfig',
  'resolveCard',
  'getAuthenticatedExtendedCard',
  'health',
  'authErrors',
  'malformedRequests',
  'versionNegotiation',
] as const;

type TransportOperationName = (typeof transportOperationNames)[number];

interface TransportCapability {
  supported: boolean;
  reason?: string;
}

export type TransportCapabilityMap = Record<TransportOperationName, TransportCapability>;

interface TransportContractFailure {
  code?: number | string;
  message: string;
}

interface SendMessageOptions {
  contextId?: string;
  returnImmediately?: boolean;
}

interface TransportContractSession {
  sendMessage(text: string, options?: SendMessageOptions): Promise<Task>;
  streamMessage?(text: string, options?: SendMessageOptions): Promise<AsyncIterable<Task>>;
  getTask(taskId: string): Promise<Task | null | undefined>;
  listTasks?(params?: TaskListParams): Promise<TaskListResult>;
  cancelTask?(taskId: string): Promise<Task | null | undefined>;
  resubscribeTask?(taskId: string): Promise<AsyncIterable<Task>>;
  createPushNotificationConfig?(
    taskId: string,
    config: PushNotificationConfig,
    configId?: string,
  ): Promise<PushNotificationConfig | null | undefined>;
  getPushNotificationConfig?(
    taskId: string,
    configId?: string,
  ): Promise<PushNotificationConfig | null | undefined>;
  listPushNotificationConfigs?(taskId: string): Promise<{ configs: PushNotificationConfig[] }>;
  deletePushNotificationConfig?(taskId: string, configId?: string): Promise<{ deleted: boolean }>;
  resolveCard?(): Promise<AgentCard>;
  getAuthenticatedExtendedCard?(): Promise<AgentCard>;
  health?(): Promise<A2AHealthResponse | Record<string, unknown>>;
  sendWithoutAuth?(): Promise<TransportContractFailure>;
  sendMalformedRequest?(): Promise<TransportContractFailure>;
  negotiateUnsupportedVersion?(): Promise<TransportContractFailure>;
  close(): Promise<void>;
}

export interface TransportContractSpec {
  name: string;
  capabilities: TransportCapabilityMap;
  createSession: () => Promise<TransportContractSession>;
}

export function runTransportContract(spec: TransportContractSpec): void {
  describe(`${spec.name} transport contract`, () => {
    it(`${spec.name}: declares every supported and unsupported operation`, () => {
      expect(Object.keys(spec.capabilities).sort()).toEqual([...transportOperationNames].sort());

      for (const operationName of transportOperationNames) {
        const capability = spec.capabilities[operationName];
        expect(typeof capability.supported).toBe('boolean');
        if (!capability.supported) {
          expect(capability.reason?.trim()).toBeTruthy();
        }
      }
    });

    it(`${spec.name}: resolves an agent card when supported`, async () => {
      const capability = spec.capabilities.resolveCard;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.resolveCard).toBeDefined();
        const card = await session.resolveCard!();
        expect(card.protocolVersion).toMatch(/^(1\.0|1\.2)$/);
        expect(card.name).toContain('Contract');
        expect(card.supportedInterfaces?.length ?? 0).toBeGreaterThan(0);
      });
    });

    it(`${spec.name}: returns health when supported`, async () => {
      const capability = spec.capabilities.health;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.health).toBeDefined();
        const health = await session.health!();
        expect(health['status']).toBe('healthy');
      });
    });

    it(`${spec.name}: sends a message and exposes the completed task through getTask`, async () => {
      await withSession(spec, async (session) => {
        const task = await session.sendMessage('contract echo', { contextId: `${spec.name}-ctx` });
        expect(task.id).toBeTruthy();

        const completed = await waitForTaskState(session, task.id, ['COMPLETED']);
        expect(readTaskText(completed)).toContain('contract echo');
        expect(completed.artifacts?.[0]?.metadata?.['taskId']).toBe(completed.id);
      });
    });

    it(`${spec.name}: lists tasks with context filtering and pagination when supported`, async () => {
      const capability = spec.capabilities.listTasks;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.listTasks).toBeDefined();
        const first = await session.sendMessage('contract list first', { contextId: 'list-a' });
        const second = await session.sendMessage('contract list second', { contextId: 'list-b' });
        await waitForTaskState(session, first.id, ['COMPLETED']);
        await waitForTaskState(session, second.id, ['COMPLETED']);

        const filtered = await session.listTasks!({ contextId: 'list-a', limit: 1, offset: 0 });
        expect(filtered.total).toBe(1);
        expect(filtered.tasks.map((task) => task.id)).toEqual([first.id]);
      });
    });

    it(`${spec.name}: cancels a task when supported`, async () => {
      const capability = spec.capabilities.cancelTask;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.cancelTask).toBeDefined();
        const task = await session.sendMessage('contract-cancel', {
          contextId: `${spec.name}-cancel`,
          returnImmediately: true,
        });
        const canceled = await session.cancelTask!(task.id);
        expect(canceled?.status.state).toBe('CANCELED');

        const stored = await waitForTaskState(session, task.id, ['CANCELED']);
        expect(stored.status.state).toBe('CANCELED');
      });
    });

    it(`${spec.name}: resubscribes to an active task when supported`, async () => {
      const capability = spec.capabilities.resubscribeTask;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.resubscribeTask).toBeDefined();
        const task = await session.sendMessage('contract-resubscribe', {
          contextId: `${spec.name}-resubscribe`,
          returnImmediately: true,
        });
        const stream = await session.resubscribeTask!(task.id);
        const updates: Task[] = [];
        for await (const update of stream) {
          updates.push(update);
        }

        expect(updates.length).toBeGreaterThan(0);
        const terminal = updates.find((update) => TERMINAL_STATES.has(update.status.state));
        expect(terminal?.status.state).toBe('COMPLETED');
        expect(readTaskText(terminal!)).toContain('contract-resubscribe');
      });
    });

    it(`${spec.name}: manages push notification configurations when supported`, async () => {
      const operations = [
        'createPushNotificationConfig',
        'getPushNotificationConfig',
        'listPushNotificationConfigs',
        'deletePushNotificationConfig',
      ] as const;
      const unsupported = operations.find((name) => !spec.capabilities[name].supported);
      if (unsupported) {
        expect(spec.capabilities[unsupported].reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.createPushNotificationConfig).toBeDefined();
        expect(session.getPushNotificationConfig).toBeDefined();
        expect(session.listPushNotificationConfigs).toBeDefined();
        expect(session.deletePushNotificationConfig).toBeDefined();

        const task = await session.sendMessage('contract-push-config', {
          contextId: `${spec.name}-push-config`,
          returnImmediately: true,
        });
        const config: PushNotificationConfig = {
          id: 'contract-hook',
          url: 'https://hooks.example.test/a2a',
          metadata: { source: 'transport-contract' },
        };
        const created = await session.createPushNotificationConfig!(
          task.id,
          config,
          'contract-hook',
        );
        expect(created).toMatchObject(config);

        const read = await session.getPushNotificationConfig!(task.id, 'contract-hook');
        expect(read).toMatchObject(config);

        const listed = await session.listPushNotificationConfigs!(task.id);
        expect(listed.configs).toEqual(expect.arrayContaining([expect.objectContaining(config)]));

        await expect(
          session.deletePushNotificationConfig!(task.id, 'contract-hook'),
        ).resolves.toEqual({ deleted: true });
        await expect(
          session.getPushNotificationConfig!(task.id, 'contract-hook'),
        ).resolves.toBeNull();
      });
    });

    it(`${spec.name}: returns an authenticated extended card when supported`, async () => {
      const capability = spec.capabilities.getAuthenticatedExtendedCard;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.getAuthenticatedExtendedCard).toBeDefined();
        const card = await session.getAuthenticatedExtendedCard!();
        expect(card.capabilities?.extendedAgentCard).toBe(true);
        expect(card.name).toContain('Contract');
      });
    });

    it(`${spec.name}: streams terminal task updates when supported`, async () => {
      const capability = spec.capabilities.streamMessage;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.streamMessage).toBeDefined();
        const stream = await session.streamMessage!('contract stream', {
          contextId: `${spec.name}-stream`,
        });
        const updates: Task[] = [];
        for await (const update of stream) {
          updates.push(update);
        }

        expect(updates.length).toBeGreaterThan(0);
        const terminal = updates.find((update) => TERMINAL_STATES.has(update.status.state));
        expect(terminal?.status.state).toBe('COMPLETED');
        expect(readTaskText(terminal!)).toContain('contract stream');
      });
    });

    it(`${spec.name}: rejects unauthenticated send requests when supported`, async () => {
      const capability = spec.capabilities.authErrors;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.sendWithoutAuth).toBeDefined();
        const failure = await session.sendWithoutAuth!();
        expect(failure.message).toMatch(/unauthorized|auth/i);
      });
    });

    it(`${spec.name}: reports malformed requests when supported`, async () => {
      const capability = spec.capabilities.malformedRequests;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.sendMalformedRequest).toBeDefined();
        const failure = await session.sendMalformedRequest!();
        expect(failure.message).toMatch(/invalid|malformed|json-rpc|envelope/i);
      });
    });

    it(`${spec.name}: rejects unsupported protocol versions when supported`, async () => {
      const capability = spec.capabilities.versionNegotiation;
      if (!capability.supported) {
        expect(capability.reason).toContain(spec.name);
        return;
      }

      await withSession(spec, async (session) => {
        expect(session.negotiateUnsupportedVersion).toBeDefined();
        const failure = await session.negotiateUnsupportedVersion!();
        expect(failure.message).toMatch(/protocol version|version.*not supported/i);
      });
    });
  });
}

async function waitForTaskState(
  session: Pick<TransportContractSession, 'getTask'>,
  taskId: string,
  states: TaskState[],
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<Task> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const task = await session.getTask(taskId);
    if (task && states.includes(task.status.state)) {
      return task;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${taskId} to reach ${states.join(', ')}`);
}

function readTaskText(task: Task): string {
  return [
    ...task.history.flatMap((message) => message.parts),
    ...(task.artifacts ?? []).flatMap((artifact) => artifact.parts),
  ]
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

async function withSession(
  spec: TransportContractSpec,
  run: (session: TransportContractSession) => Promise<void>,
): Promise<void> {
  const session = await spec.createSession();
  try {
    await run(session);
  } finally {
    await session.close();
  }
}
