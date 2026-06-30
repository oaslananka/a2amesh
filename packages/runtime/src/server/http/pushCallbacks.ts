import { validateUrl, type OutboundPolicyOptions } from '../../net/OutboundPolicy.js';
import { ErrorCodes, JsonRpcError } from '../../types/jsonrpc.js';
import type { MessageSendParams, Task } from '../../types/task.js';
import type { RuntimeMetrics } from '../../telemetry/index.js';
import { logger } from '../../utils/logger.js';
import type { PushNotificationService } from '../PushNotificationService.js';
import type { SSEStreamer } from '../SSEStreamer.js';
import type { TaskManager } from '../TaskManager.js';

type PushNotificationConfig = NonNullable<
  NonNullable<MessageSendParams['configuration']>['pushNotificationConfig']
>;

export interface TaskObserverDependencies {
  taskManager: TaskManager;
  streamer: SSEStreamer;
  pushNotificationService: PushNotificationService;
  runtimeMetrics: RuntimeMetrics;
}

export async function normalizePushNotificationConfig(
  config: PushNotificationConfig,
  options: OutboundPolicyOptions,
): Promise<PushNotificationConfig> {
  try {
    await validateUrl(config.url, options);
    return { ...config };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JsonRpcError(ErrorCodes.InvalidParams, `Invalid push notification URL: ${message}`);
  }
}

export function bindTaskObservers(deps: TaskObserverDependencies): void {
  deps.taskManager.on('taskUpdated', async ({ task, reason, previousState }) => {
    if (reason === 'created') {
      deps.runtimeMetrics.recordTaskCreated();
    }
    if (reason === 'state') {
      deps.runtimeMetrics.recordTaskStateChange(task, previousState);
    }

    if (reason !== 'push-config') {
      deps.streamer.sendTaskUpdate(task.id, task);
    }

    if (reason === 'state') {
      await sendPushNotification(task, deps);
    }
  });
}

async function sendPushNotification(task: Task, deps: TaskObserverDependencies): Promise<void> {
  const pushConfigs = deps.taskManager.listPushNotifications(task.id);
  if (pushConfigs.length === 0) {
    return;
  }

  await Promise.all(
    pushConfigs.map(async (pushConfig) => {
      try {
        await deps.pushNotificationService.retryWithBackoff(() =>
          deps.pushNotificationService.sendNotification(pushConfig, task),
        );
      } catch (error: unknown) {
        logger.error('Push notification delivery failed', {
          taskId: task.id,
          pushNotificationConfigId: pushConfig.id,
          ...(task.contextId ? { contextId: task.contextId } : {}),
          error,
        });
      }
    }),
  );
}
