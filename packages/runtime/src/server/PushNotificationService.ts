/**
 * @file PushNotificationService.ts
 * Delivery of A2A task updates to client webhooks.
 */

import type { PushNotificationConfig, Task } from '../types/task.js';
import { logger } from '../utils/logger.js';
import { CircuitBreaker, CircuitOpenError, type CircuitBreakerOptions } from './CircuitBreaker.js';
import { validateAndFetch, type OutboundPolicyOptions } from '../net/OutboundPolicy.js';

export interface PushNotificationServiceOptions {
  circuitBreaker?: CircuitBreakerOptions;
  maxConcurrent?: number;
  outboundPolicy?: OutboundPolicyOptions;
}

type QueuedNotification = {
  config: PushNotificationConfig;
  task: Task;
  resolve: () => void;
  reject: (err: unknown) => void;
};

export class PushNotificationService {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly queue: QueuedNotification[] = [];
  private activeCount = 0;
  private isProcessing = false;
  private isStopped = false;

  constructor(private readonly options: PushNotificationServiceOptions = {}) {}

  public stop(): void {
    this.isStopped = true;
    this.queue.length = 0;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isStopped) return;
    this.isProcessing = true;

    const limit = this.options.maxConcurrent ?? 10;

    try {
      while (this.queue.length > 0 && !this.isStopped) {
        if (this.activeCount >= limit) {
          await new Promise((r) => setTimeout(r, 100)); // Wait for a slot
          continue;
        }

        const item = this.queue.shift();
        if (!item) continue;

        this.activeCount++;

        // Execute the delivery in the background without awaiting it here
        // so we can launch up to `limit` concurrently.
        this.executeDelivery(item.config, item.task)
          .then(item.resolve)
          .catch(item.reject)
          .finally(() => {
            this.activeCount--;
          });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeDelivery(config: PushNotificationConfig, task: Task): Promise<void> {
    const breaker = this.getBreakerFor(config.url);

    try {
      await breaker.execute(async () => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Idempotency-Key': task.id,
        };

        let url = config.url;
        if (config.token) {
          headers['X-A2A-Notification-Token'] = config.token;
        }

        if (config.authentication && config.token) {
          if (config.authentication.type === 'apiKey') {
            if (config.authentication.in === 'header') {
              headers[config.authentication.name] = config.token;
            } else {
              const nextUrl = new URL(url);
              nextUrl.searchParams.set(config.authentication.name, config.token);
              url = nextUrl.toString();
            }
          }

          if (config.authentication.type === 'http') {
            headers['Authorization'] = `Bearer ${config.token}`;
          }

          if (config.authentication.type === 'openIdConnect') {
            headers['Authorization'] = `Bearer ${config.token}`;
          }
        }

        const response = await validateAndFetch(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(task),
          },
          this.createOutboundPolicyOptions(),
        );

        try {
          if (!response.ok) {
            throw new Error(`Push notification failed: HTTP ${response.status}`);
          }
        } finally {
          await response.body?.cancel().catch(() => undefined);
        }
      });
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        logger.warn('Push notification skipped - circuit open', {
          taskId: task.id,
          url: config.url,
        });
        return;
      }

      throw error;
    }
  }

  private getBreakerFor(url: string): CircuitBreaker {
    const existing = this.breakers.get(url);
    if (existing) {
      return existing;
    }

    const breaker = new CircuitBreaker(`push:${url}`, this.options.circuitBreaker);
    this.breakers.set(url, breaker);
    return breaker;
  }

  private createOutboundPolicyOptions(): OutboundPolicyOptions {
    const policy = this.options.outboundPolicy ?? {};
    return {
      ...policy,
      timeoutMs: policy.timeoutMs ?? 10000,
      retries: policy.retries ?? 0,
      telemetryLabels: {
        ...(policy.telemetryLabels ?? {}),
        'a2a.outbound.operation': 'push-notification',
      },
    };
  }

  /**
   * Sends a task snapshot to the configured webhook endpoint.
   *
   * @param config Webhook delivery configuration.
   * @param task Current task snapshot to deliver.
   * @returns Resolves when delivery succeeds.
   * @throws When the endpoint responds with a non-2xx status.
   */
  async sendNotification(config: PushNotificationConfig, task: Task): Promise<void> {
    if (this.isStopped) return;

    return new Promise((resolve, reject) => {
      this.queue.push({ config, task, resolve, reject });

      // We don't await processQueue here, it runs asynchronously to pull from the queue
      void this.processQueue();
    });
  }

  /**
   * Executes an async action with exponential backoff.
   *
   * @param fn Async operation to retry.
   * @param maxRetries Maximum number of retry attempts.
   * @returns Resolves when the operation succeeds.
   * @throws Re-throws the last failure when retries are exhausted.
   */
  async retryWithBackoff(fn: () => Promise<void>, maxRetries = 3): Promise<void> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxRetries) {
      try {
        await fn();
        return;
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          return;
        }
        lastError = error;
        attempt += 1;
        if (attempt >= maxRetries) {
          break;
        }

        const delayMs = 250 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
