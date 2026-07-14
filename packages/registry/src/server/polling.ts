import { logger, validateAndFetch, type Task } from '@a2amesh/runtime';
import type { RegisteredAgent } from '../storage/IAgentStorage.js';
import type { RegistryDistributedPollingLeaseStore } from '../storage/RedisStorage.js';
import { createRegistryOutboundPolicy } from './outboundPolicy.js';
import type { RegistryServerContext } from './types.js';
import {
  createRegistryTaskProjection,
  type RegistryTaskProjectionController,
} from './taskProjection.js';

export interface RegistryPollingController {
  executeHealthChecks(agents: RegisteredAgent[]): Promise<void>;
  startHealthChecks(): void;
  refreshTaskSnapshots(): Promise<void>;
  executeTaskPolling(agents: RegisteredAgent[]): Promise<void>;
  pollAgentTasks(agent: RegisteredAgent): Promise<void>;
  startTaskPolling(): void;
  stop(): void;
  isHealthCheckDue(agent: RegisteredAgent): boolean;
  scheduleNextHealthCheck(agent: RegisteredAgent): void;
  isTaskPollDue(agent: RegisteredAgent): boolean;
  scheduleNextTaskPoll(agent: RegisteredAgent): void;
}

export function createRegistryPolling(
  context: RegistryServerContext,
  taskProjection: RegistryTaskProjectionController = createRegistryTaskProjection(context),
): RegistryPollingController {
  let pingInterval: NodeJS.Timeout | null = null;
  let taskPollInterval: NodeJS.Timeout | null = null;
  const leaseOwnerId = context.options.pollingLeaseOwnerId ?? `registry-${process.pid}`;

  const isHealthCheckDue = (agent: RegisteredAgent): boolean =>
    (context.nextHealthCheckAt.get(agent.id) ?? 0) <= Date.now();

  const scheduleNextHealthCheck = (agent: RegisteredAgent): void => {
    const intervalMs =
      agent.status === 'healthy'
        ? (context.options.healthyRecheckIntervalMs ?? 30_000)
        : agent.status === 'unhealthy'
          ? (context.options.unhealthyRecheckIntervalMs ?? 60_000)
          : (context.options.unknownRecheckIntervalMs ?? 15_000);
    context.nextHealthCheckAt.set(agent.id, Date.now() + intervalMs);
  };

  const isTaskPollDue = (agent: RegisteredAgent): boolean =>
    (context.nextTaskPollAt.get(agent.id) ?? 0) <= Date.now();

  const scheduleNextTaskPoll = (agent: RegisteredAgent): void => {
    const baseIntervalMs = context.options.taskPollCooldownMs ?? 5_000;
    const multiplier = agent.status === 'unhealthy' ? 3 : 1;
    context.nextTaskPollAt.set(agent.id, Date.now() + baseIntervalMs * multiplier);
  };

  const executeHealthChecks = async (agents: RegisteredAgent[]): Promise<void> => {
    const concurrencyLimit = context.options.healthCheckConcurrency ?? 5;
    for (let i = 0; i < agents.length; i += concurrencyLimit) {
      const chunk = agents.slice(i, i + concurrencyLimit);

      await Promise.all(
        chunk.map(async (agent) => {
          const jitterMs = Math.random() * 500;
          await new Promise((resolve) => setTimeout(resolve, jitterMs));

          try {
            const response = await validateAndFetch(
              buildAgentUrl(agent.url, '/health'),
              undefined,
              createRegistryOutboundPolicy(context, {
                timeoutMs: 5000,
                retries: 0,
                telemetryLabels: { 'a2a.registry.operation': 'health-check' },
              }),
            );

            const status = response.ok ? 'healthy' : 'unhealthy';
            const consecutiveFailures = response.ok ? 0 : (agent.consecutiveFailures ?? 0) + 1;
            const lastSuccessAt = response.ok ? new Date().toISOString() : agent.lastSuccessAt;
            await response.body?.cancel().catch(() => undefined);

            await context.store.updateStatus(agent.id, status, {
              consecutiveFailures,
              ...(lastSuccessAt ? { lastSuccessAt } : {}),
            });
            scheduleNextHealthCheck({
              ...agent,
              status,
              consecutiveFailures,
              ...(lastSuccessAt ? { lastSuccessAt } : {}),
            });
          } catch (error) {
            const consecutiveFailures = (agent.consecutiveFailures ?? 0) + 1;
            await context.store.updateStatus(agent.id, 'unhealthy', { consecutiveFailures });
            scheduleNextHealthCheck({
              ...agent,
              status: 'unhealthy',
              consecutiveFailures,
            });
            logger.warn('Agent unreachable', {
              agentId: agent.id,
              error: String(error),
              consecutiveFailures,
            });
          }
        }),
      );
    }
  };

  const refreshTaskSnapshots = async (): Promise<void> => {
    const result = await context.store.list({
      cursor: context.state.taskCursor ?? undefined,
      limit: context.options.taskPollingBatchSize ?? 50,
    });
    context.state.taskCursor = result.nextCursor;
    const agents = result.items.filter((agent) => isTaskPollDue(agent));
    if (agents.length === 0) {
      return;
    }

    await executeTaskPolling(agents);
  };

  const executeTaskPolling = async (agents: RegisteredAgent[]): Promise<void> => {
    const concurrencyLimit = context.options.taskPollingConcurrency ?? 5;

    for (let index = 0; index < agents.length; index += concurrencyLimit) {
      const chunk = agents.slice(index, index + concurrencyLimit);
      await Promise.all(chunk.map(async (agent) => pollAgentTasks(agent)));
    }
  };

  const pollAgentTasks = async (agent: RegisteredAgent): Promise<void> => {
    try {
      const response = await validateAndFetch(
        buildAgentUrl(agent.url, '/tasks?limit=20'),
        undefined,
        createRegistryOutboundPolicy(context, {
          timeoutMs: 5_000,
          retries: 0,
          telemetryLabels: { 'a2a.registry.operation': 'task-poll' },
        }),
      );

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }

      const tasks = await response.json();
      if (!Array.isArray(tasks)) {
        scheduleNextTaskPoll(agent);
        logger.debug('Skipping task poll response with non-array payload', {
          agentId: agent.id,
        });
        return;
      }

      for (const task of tasks) {
        if (!isPollableTask(task)) {
          logger.debug('Skipping malformed task payload during registry polling', {
            agentId: agent.id,
          });
          continue;
        }

        const taskEvent = taskProjection.recordTask(agent, task);
        if (taskEvent) {
          context.taskEvents.emit('task_updated', taskEvent);
        }
      }
      scheduleNextTaskPoll(agent);
    } catch (error) {
      scheduleNextTaskPoll(agent);
      logger.debug('Skipping task poll for agent', {
        agentId: agent.id,
        error: String(error),
      });
    }
  };

  async function withPollingLease(
    scope: string,
    intervalMs: number,
    operation: () => Promise<void>,
  ): Promise<void> {
    if (context.options.distributedPollingLeases !== true) {
      await operation();
      return;
    }

    const leaseStore = resolvePollingLeaseStore(context.store);
    if (!leaseStore) {
      logger.warn('Distributed registry polling requested without a lease-capable store', {
        scope,
      });
      return;
    }

    const ttlMs = context.options.pollingLeaseTtlMs ?? Math.max(intervalMs * 2, 10_000);
    const acquired = await leaseStore.acquirePollingLease(scope, leaseOwnerId, ttlMs);
    if (!acquired) {
      logger.debug('Skipping registry polling because another instance holds the lease', { scope });
      return;
    }

    try {
      await operation();
    } finally {
      await leaseStore.releasePollingLease(scope, leaseOwnerId);
    }
  }

  return {
    executeHealthChecks,
    startHealthChecks(): void {
      pingInterval = setInterval(async () => {
        try {
          await withPollingLease(
            'health',
            context.options.healthPollingIntervalMs ?? 30_000,
            async () => {
              const result = await context.store.list({
                cursor: context.state.healthCursor ?? undefined,
                limit: context.options.healthCheckBatchSize ?? 50,
              });
              context.state.healthCursor = result.nextCursor;
              await executeHealthChecks(result.items.filter((agent) => isHealthCheckDue(agent)));
            },
          );
        } catch (error) {
          logger.error('Failed to run health checks', { error: String(error) });
        }
      }, context.options.healthPollingIntervalMs ?? 30_000);
    },
    refreshTaskSnapshots,
    executeTaskPolling,
    pollAgentTasks,
    startTaskPolling(): void {
      const intervalMs = context.options.taskPollingIntervalMs ?? 5_000;
      taskPollInterval = setInterval(() => {
        void withPollingLease('task-snapshots', intervalMs, refreshTaskSnapshots).catch(
          (error: unknown) => {
            logger.warn('Failed to refresh registry task snapshots', {
              error: String(error),
            });
          },
        );
      }, intervalMs);
    },
    stop(): void {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (taskPollInterval) {
        clearInterval(taskPollInterval);
        taskPollInterval = null;
      }
    },
    isHealthCheckDue,
    scheduleNextHealthCheck,
    isTaskPollDue,
    scheduleNextTaskPoll,
  };
}

function resolvePollingLeaseStore(store: unknown): RegistryDistributedPollingLeaseStore | null {
  if (
    typeof store === 'object' &&
    store !== null &&
    typeof (store as Partial<RegistryDistributedPollingLeaseStore>).acquirePollingLease ===
      'function' &&
    typeof (store as Partial<RegistryDistributedPollingLeaseStore>).releasePollingLease ===
      'function'
  ) {
    return store as RegistryDistributedPollingLeaseStore;
  }

  return null;
}

function buildAgentUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function isPollableTask(value: unknown): value is Task {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !isTaskStatus(value['status'])) {
    return false;
  }

  if (!Array.isArray(value['history']) || !value['history'].every(hasSafeParts)) {
    return false;
  }

  return (
    value['artifacts'] === undefined ||
    (Array.isArray(value['artifacts']) && value['artifacts'].every(hasSafeParts))
  );
}

function isTaskStatus(value: unknown): value is Task['status'] {
  return (
    isRecord(value) && typeof value['state'] === 'string' && typeof value['timestamp'] === 'string'
  );
}

function hasSafeParts(value: unknown): value is { parts: Array<Record<string, unknown>> } {
  return isRecord(value) && Array.isArray(value['parts']) && value['parts'].every(isSafePart);
}

function isSafePart(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (value['type'] !== 'text' || typeof value['text'] === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
