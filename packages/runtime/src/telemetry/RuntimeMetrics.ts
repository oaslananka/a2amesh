/**
 * Runtime metrics backed by the optional OpenTelemetry API.
 */
import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from '@opentelemetry/api';
import type { Task, TaskCounts, TaskState } from '@a2amesh/protocol';

export interface RuntimeMetricsOptions {
  serviceName: string;
  serviceVersion: string;
}

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
const IDEMPOTENCY_OUTCOMES = [
  'acquired',
  'recovered',
  'replay',
  'in-progress',
  'conflict',
  'lease-lost',
] as const;

export type RuntimeIdempotencyOutcome = (typeof IDEMPOTENCY_OUTCOMES)[number];

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export class RuntimeMetrics {
  private readonly counters = new Map<string, number>();
  private readonly durationBuckets = new Map<number, number>();
  private readonly metricAttributes: Attributes;
  private readonly taskCreatedCounter: Counter;
  private readonly taskStartedCounter: Counter;
  private readonly taskCompletedCounter: Counter;
  private readonly taskFailedCounter: Counter;
  private readonly taskCanceledCounter: Counter;
  private readonly authRejectedCounter: Counter;
  private readonly idempotencyCounter: Counter;
  private readonly sseConnectionsCounter: Counter;
  private readonly sseReconnectCounter: Counter;
  private readonly sseActiveConnectionsCounter: UpDownCounter;
  private readonly taskDurationHistogram: Histogram;
  private durationCount = 0;
  private durationSum = 0;
  private sseActiveConnections = 0;

  constructor(private readonly options: RuntimeMetricsOptions) {
    for (const bucket of DURATION_BUCKETS_MS) {
      this.durationBuckets.set(bucket, 0);
    }

    this.metricAttributes = {
      service_name: options.serviceName,
      service_version: options.serviceVersion,
    };
    const meter = metrics.getMeter('@a2amesh/runtime', '1.0.0');
    this.taskCreatedCounter = meter.createCounter('a2a_runtime_task_created_total', {
      description: 'Total tasks created by the runtime.',
    });
    this.taskStartedCounter = meter.createCounter('a2a_runtime_task_started_total', {
      description: 'Total tasks that entered working state.',
    });
    this.taskCompletedCounter = meter.createCounter('a2a_runtime_task_completed_total', {
      description: 'Total tasks completed successfully.',
    });
    this.taskFailedCounter = meter.createCounter('a2a_runtime_task_failed_total', {
      description: 'Total tasks that failed.',
    });
    this.taskCanceledCounter = meter.createCounter('a2a_runtime_task_canceled_total', {
      description: 'Total tasks canceled.',
    });
    this.authRejectedCounter = meter.createCounter('a2a_runtime_auth_rejected_total', {
      description: 'Total rejected authenticated requests.',
    });
    this.idempotencyCounter = meter.createCounter('a2a_runtime_idempotency_total', {
      description: 'Idempotency reservation outcomes by bounded outcome label.',
    });
    this.sseConnectionsCounter = meter.createCounter('a2a_runtime_sse_connections_total', {
      description: 'Total SSE connections opened.',
    });
    this.sseReconnectCounter = meter.createCounter('a2a_runtime_sse_reconnect_total', {
      description: 'Total SSE reconnects detected.',
    });
    this.sseActiveConnectionsCounter = meter.createUpDownCounter(
      'a2a_runtime_sse_connections_active',
      {
        description: 'Active SSE connections.',
      },
    );
    this.taskDurationHistogram = meter.createHistogram('a2a_runtime_task_duration_ms', {
      description: 'Task duration in milliseconds.',
      unit: 'ms',
    });
  }

  recordTaskCreated(): void {
    this.increment('a2a_runtime_task_created_total');
    this.taskCreatedCounter.add(1, this.metricAttributes);
  }

  recordTaskStateChange(task: Task, previousState?: TaskState): void {
    if (task.status.state !== previousState) {
      this.increment(`a2a_runtime_task_state_transitions_total{state="${task.status.state}"}`);
    }

    switch (task.status.state) {
      case 'WORKING':
        if (previousState !== 'WORKING') {
          this.increment('a2a_runtime_task_started_total');
          this.taskStartedCounter.add(1, this.metricAttributes);
        }
        break;
      case 'COMPLETED':
        this.increment('a2a_runtime_task_completed_total');
        this.taskCompletedCounter.add(1, this.metricAttributes);
        this.observeDuration(task);
        break;
      case 'FAILED':
        this.increment('a2a_runtime_task_failed_total');
        this.taskFailedCounter.add(1, this.metricAttributes);
        this.observeDuration(task);
        break;
      case 'CANCELED':
        this.increment('a2a_runtime_task_canceled_total');
        this.taskCanceledCounter.add(1, this.metricAttributes);
        this.observeDuration(task);
        break;
      default:
        break;
    }
  }

  recordAuthReject(): void {
    this.increment('a2a_runtime_auth_rejected_total');
    this.authRejectedCounter.add(1, this.metricAttributes);
  }

  recordIdempotencyOutcome(outcome: RuntimeIdempotencyOutcome): void {
    this.increment(`a2a_runtime_idempotency_total{outcome="${outcome}"}`);
    this.idempotencyCounter.add(1, { ...this.metricAttributes, outcome });
  }

  recordSseConnectionOpened(isReconnect = false): void {
    this.increment('a2a_runtime_sse_connections_total');
    this.sseConnectionsCounter.add(1, this.metricAttributes);
    if (isReconnect) {
      this.increment('a2a_runtime_sse_reconnect_total');
      this.sseReconnectCounter.add(1, this.metricAttributes);
    }
    this.sseActiveConnections += 1;
    this.sseActiveConnectionsCounter.add(1, this.metricAttributes);
  }

  recordSseConnectionClosed(): void {
    const previousActiveConnections = this.sseActiveConnections;
    this.sseActiveConnections = Math.max(this.sseActiveConnections - 1, 0);
    if (previousActiveConnections > this.sseActiveConnections) {
      this.sseActiveConnectionsCounter.add(-1, this.metricAttributes);
    }
  }

  renderPrometheus(taskCounts: TaskCounts): string {
    const serviceLabels = `service_name="${escapeLabel(this.options.serviceName)}",service_version="${escapeLabel(this.options.serviceVersion)}"`;
    const lines = [
      '# HELP a2a_runtime_task_created_total Total tasks created by the runtime.',
      '# TYPE a2a_runtime_task_created_total counter',
      `${this.renderCounter('a2a_runtime_task_created_total')} `,
      '# HELP a2a_runtime_task_started_total Total tasks that entered working state.',
      '# TYPE a2a_runtime_task_started_total counter',
      `${this.renderCounter('a2a_runtime_task_started_total')} `,
      '# HELP a2a_runtime_task_completed_total Total tasks completed successfully.',
      '# TYPE a2a_runtime_task_completed_total counter',
      `${this.renderCounter('a2a_runtime_task_completed_total')} `,
      '# HELP a2a_runtime_task_failed_total Total tasks that failed.',
      '# TYPE a2a_runtime_task_failed_total counter',
      `${this.renderCounter('a2a_runtime_task_failed_total')} `,
      '# HELP a2a_runtime_task_canceled_total Total tasks canceled.',
      '# TYPE a2a_runtime_task_canceled_total counter',
      `${this.renderCounter('a2a_runtime_task_canceled_total')} `,
      '# HELP a2a_runtime_auth_rejected_total Total rejected authenticated requests.',
      '# TYPE a2a_runtime_auth_rejected_total counter',
      `${this.renderCounter('a2a_runtime_auth_rejected_total')} `,
      '# HELP a2a_runtime_idempotency_total Idempotency reservation outcomes by bounded outcome label.',
      '# TYPE a2a_runtime_idempotency_total counter',
      ...IDEMPOTENCY_OUTCOMES.map((outcome) => {
        const counterKey = `a2a_runtime_idempotency_total{outcome="${outcome}"}`;
        return `a2a_runtime_idempotency_total{${serviceLabels},outcome="${outcome}"} ${this.counters.get(counterKey) ?? 0}`;
      }),
      '# HELP a2a_runtime_sse_connections_total Total SSE connections opened.',
      '# TYPE a2a_runtime_sse_connections_total counter',
      `${this.renderCounter('a2a_runtime_sse_connections_total')} `,
      '# HELP a2a_runtime_sse_reconnect_total Total SSE reconnects detected.',
      '# TYPE a2a_runtime_sse_reconnect_total counter',
      `${this.renderCounter('a2a_runtime_sse_reconnect_total')} `,
      '# HELP a2a_runtime_sse_connections_active Active SSE connections.',
      '# TYPE a2a_runtime_sse_connections_active gauge',
      `a2a_runtime_sse_connections_active{${serviceLabels}} ${this.sseActiveConnections}`,
      '# HELP a2a_runtime_tasks_active Active tasks.',
      '# TYPE a2a_runtime_tasks_active gauge',
      `a2a_runtime_tasks_active{${serviceLabels}} ${taskCounts.active}`,
      '# HELP a2a_runtime_task_duration_ms Task duration in milliseconds.',
      '# TYPE a2a_runtime_task_duration_ms histogram',
      ...this.renderDurationHistogram(serviceLabels),
    ];

    return lines.join('\n').replaceAll(' \n', '\n');
  }

  private increment(metricName: string): void {
    this.counters.set(metricName, (this.counters.get(metricName) ?? 0) + 1);
  }

  private renderCounter(metricName: string): string {
    const serviceLabels = `service_name="${escapeLabel(this.options.serviceName)}",service_version="${escapeLabel(this.options.serviceVersion)}"`;
    return `${metricName}{${serviceLabels}} ${this.counters.get(metricName) ?? 0}`;
  }

  private observeDuration(task: Task): void {
    const durationMs =
      typeof task.metadata?.['durationMs'] === 'number'
        ? task.metadata['durationMs']
        : typeof task.metadata?.['durationMs'] === 'string'
          ? Number(task.metadata['durationMs'])
          : Number.NaN;
    if (!Number.isFinite(durationMs)) {
      return;
    }

    this.durationCount += 1;
    this.durationSum += durationMs;
    this.taskDurationHistogram.record(durationMs, this.metricAttributes);
    for (const bucket of DURATION_BUCKETS_MS) {
      if (durationMs <= bucket) {
        this.durationBuckets.set(bucket, (this.durationBuckets.get(bucket) ?? 0) + 1);
      }
    }
  }

  private renderDurationHistogram(serviceLabels: string): string[] {
    const lines = Array.from(this.durationBuckets.entries()).map(
      ([bucket, count]) =>
        `a2a_runtime_task_duration_ms_bucket{${serviceLabels},le="${bucket}"} ${count}`,
    );
    lines.push(
      `a2a_runtime_task_duration_ms_bucket{${serviceLabels},le="+Inf"} ${this.durationCount}`,
      `a2a_runtime_task_duration_ms_sum{${serviceLabels}} ${this.durationSum}`,
      `a2a_runtime_task_duration_ms_count{${serviceLabels}} ${this.durationCount}`,
    );
    return lines;
  }
}
