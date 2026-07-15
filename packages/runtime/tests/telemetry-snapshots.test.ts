import request from 'supertest';
import {
  metrics as otelMetrics,
  propagation,
  SpanStatusCode as OtelSpanStatusCode,
  trace,
} from '@opentelemetry/api';
import {
  core as otelCore,
  metrics as sdkMetrics,
  node as traceNode,
  tracing,
} from '@opentelemetry/sdk-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2AClient } from '../src/client/A2AClient.js';
import { FetchResponseLimitError, fetchWithPolicy } from '../src/net/fetchWithPolicy.js';
import { A2AServer, type A2AServerOptions } from '../src/server/A2AServer.js';
import { RuntimeMetrics } from '@a2amesh/runtime';
import type { AgentCard } from '../src/types/agent-card.js';
import type { Artifact, Message, Task, TaskState } from '../src/types/task.js';

const agentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'Telemetry Snapshot Agent',
  description: 'Telemetry snapshot test harness',
  url: 'http://localhost:0',
  version: '1.2.3',
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
    extendedAgentCard: true,
  },
};

class TelemetryHarnessServer extends A2AServer {
  constructor(options: A2AServerOptions = {}) {
    super(agentCard, options);
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const text = message.parts.find((part) => part.type === 'text');

    return [
      {
        artifactId: 'telemetry-artifact',
        index: 0,
        lastChunk: true,
        parts: [
          {
            type: 'text',
            text: text?.type === 'text' ? `echo:${text.text}` : 'echo:',
          },
        ],
      },
    ];
  }
}

function createMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: `message-${text}`,
    timestamp: '2026-05-25T00:00:00.000Z',
    contextId: 'context-telemetry',
  };
}

function createTask(state: TaskState, durationMs?: number): Task {
  return {
    id: `task-${state.toLowerCase()}`,
    contextId: 'context-telemetry',
    status: {
      state,
      timestamp: '2026-05-25T00:00:00.000Z',
    },
    history: [],
    artifacts: [],
    ...(durationMs !== undefined ? { metadata: { durationMs } } : {}),
  };
}

function setupTelemetryHarness() {
  trace.disable();
  otelMetrics.disable();
  propagation.disable();

  const spanExporter = new tracing.InMemorySpanExporter();
  const tracerProvider = new traceNode.NodeTracerProvider({
    spanProcessors: [new tracing.SimpleSpanProcessor(spanExporter)],
  });
  tracerProvider.register();
  propagation.setGlobalPropagator(new otelCore.W3CTraceContextPropagator());

  const metricExporter = new sdkMetrics.InMemoryMetricExporter(
    sdkMetrics.AggregationTemporality.CUMULATIVE,
  );
  const metricReader = new sdkMetrics.PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });
  const meterProvider = new sdkMetrics.MeterProvider({
    readers: [metricReader],
  });
  otelMetrics.setGlobalMeterProvider(meterProvider);

  return {
    spanExporter,
    metricExporter,
    metricReader,
    async shutdown(): Promise<void> {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      spanExporter.reset();
      metricExporter.reset();
      trace.disable();
      otelMetrics.disable();
      propagation.disable();
    },
  };
}

type TelemetryHarness = ReturnType<typeof setupTelemetryHarness>;

let telemetry: TelemetryHarness | undefined;

afterEach(async () => {
  await telemetry?.shutdown();
  telemetry = undefined;
  vi.restoreAllMocks();
});

function sortedAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => {
        if (key === 'a2a.task_id') {
          return [key, '<task-id>'];
        }

        return [key, value];
      }),
  );
}

function spanStatusName(code: number | undefined): string {
  switch (code) {
    case OtelSpanStatusCode.OK:
      return 'OK';
    case OtelSpanStatusCode.ERROR:
      return 'ERROR';
    default:
      return 'UNSET';
  }
}

function formatSpans(exporter: tracing.InMemorySpanExporter) {
  return exporter
    .getFinishedSpans()
    .filter((span) => ['a2a.handleRpc', 'a2a.processTask', 'http.request'].includes(span.name))
    .map((span) => ({
      name: span.name,
      scope: span.instrumentationScope.name,
      status: spanStatusName(span.status.code),
      attributes: sortedAttributes(span.attributes),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function formatHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const entries =
    headers instanceof Headers
      ? Array.from(headers.entries())
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers ?? {});

  return Object.fromEntries(
    entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        key.toLowerCase() === 'traceparent' ? '<traceparent>' : String(value),
      ]),
  );
}

function dataPointTypeName(type: sdkMetrics.DataPointType): string {
  switch (type) {
    case sdkMetrics.DataPointType.HISTOGRAM:
      return 'HISTOGRAM';
    case sdkMetrics.DataPointType.EXPONENTIAL_HISTOGRAM:
      return 'EXPONENTIAL_HISTOGRAM';
    case sdkMetrics.DataPointType.GAUGE:
      return 'GAUGE';
    case sdkMetrics.DataPointType.SUM:
      return 'SUM';
    default:
      return `UNKNOWN:${type}`;
  }
}

function formatMetricValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const histogram = value as {
    bucketCounts?: number[];
    buckets?: { counts?: number[]; boundaries?: number[] };
    count?: number;
    explicitBounds?: number[];
    max?: number;
    min?: number;
    sum?: number;
  };

  return {
    ...(typeof histogram.count === 'number' ? { count: histogram.count } : {}),
    ...(typeof histogram.sum === 'number' ? { sum: histogram.sum } : {}),
    ...(typeof histogram.min === 'number' ? { min: histogram.min } : {}),
    ...(typeof histogram.max === 'number' ? { max: histogram.max } : {}),
    ...(histogram.bucketCounts ? { bucketCounts: histogram.bucketCounts } : {}),
    ...(histogram.explicitBounds ? { explicitBounds: histogram.explicitBounds } : {}),
    ...(histogram.buckets?.counts ? { bucketCounts: histogram.buckets.counts } : {}),
    ...(histogram.buckets?.boundaries ? { explicitBounds: histogram.buckets.boundaries } : {}),
  };
}

function formatMetrics(exporter: sdkMetrics.InMemoryMetricExporter) {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) =>
      resourceMetrics.scopeMetrics.flatMap((scopeMetrics) =>
        scopeMetrics.metrics
          .filter((metric) => metric.descriptor.name.startsWith('a2a_'))
          .map((metric) => ({
            name: metric.descriptor.name,
            scope: scopeMetrics.scope.name,
            description: metric.descriptor.description,
            unit: metric.descriptor.unit,
            dataPointType: dataPointTypeName(metric.dataPointType),
            points: metric.dataPoints.map((point) => ({
              attributes: sortedAttributes(point.attributes),
              value: formatMetricValue(point.value),
            })),
          })),
      ),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

describe('OpenTelemetry telemetry snapshots', () => {
  it('snapshots server, client propagation and outbound HTTP spans', async () => {
    telemetry = setupTelemetryHarness();
    const server = new TelemetryHarnessServer();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'client-span',
            result: {
              id: 'client-task',
              contextId: 'context-telemetry',
              status: {
                state: 'COMPLETED',
                timestamp: '2026-05-25T00:00:00.000Z',
              },
              history: [],
              artifacts: [],
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    const created = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'span-snapshot',
        method: 'message/send',
        params: {
          message: createMessage('span snapshot'),
          contextId: 'context-telemetry',
        },
      });

    expect(created.status).toBe(200);

    const outboundResponse = await fetchWithPolicy(
      'https://downstream.example/a2a/health?token=top-secret',
      { method: 'POST' },
      {
        retries: 1,
        telemetryLabels: {
          'a2a.registry.operation': 'registration',
          'a2a.transport': 'http',
        },
      },
    );
    await outboundResponse.body?.cancel();

    const client = new A2AClient('https://agent.example', {
      fetchImplementation: fetchSpy,
    });
    await trace
      .getTracer('telemetry-snapshot-test')
      .startActiveSpan('client.parent', async (span) => {
        try {
          await client.sendMessage(createMessage('client propagation'));
        } finally {
          span.end();
        }
      });

    const [, clientInit] = fetchSpy.mock.calls.at(-1) ?? [];
    const spanSnapshot = formatSpans(telemetry.spanExporter);
    expect(JSON.stringify(spanSnapshot)).not.toContain('top-secret');
    expect(formatHeaders(clientInit?.headers)).toMatchSnapshot('client propagated headers');
    expect(spanSnapshot.map((span) => span.name)).toEqual([
      'a2a.handleRpc',
      'a2a.processTask',
      'http.request',
    ]);
    expect(spanSnapshot).toMatchSnapshot('otel spans');
  });

  it('marks response-limit failures as outbound span errors', async () => {
    telemetry = setupTelemetryHarness();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('response-too-large', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const response = await fetchWithPolicy('https://downstream.example/data', undefined, {
      maxResponseBytes: 4,
    });
    await expect(response.text()).rejects.toBeInstanceOf(FetchResponseLimitError);

    const outbound = formatSpans(telemetry.spanExporter).find(
      (span) => span.name === 'http.request',
    );
    expect(outbound?.status).toBe('ERROR');
  });

  it('snapshots runtime task, SSE and auth metric instruments', async () => {
    telemetry = setupTelemetryHarness();
    const metrics = new RuntimeMetrics({
      serviceName: 'Telemetry Snapshot Agent',
      serviceVersion: '1.2.3',
    });

    metrics.recordTaskCreated();
    metrics.recordTaskStateChange(createTask('WORKING'), 'SUBMITTED');
    metrics.recordTaskStateChange(createTask('COMPLETED', 75), 'WORKING');
    metrics.recordTaskStateChange(createTask('FAILED', 250), 'WORKING');
    metrics.recordTaskStateChange(createTask('CANCELED', 500), 'WORKING');
    metrics.recordAuthReject();
    metrics.recordSseConnectionOpened();
    metrics.recordSseConnectionOpened(true);
    metrics.recordSseConnectionClosed();
    metrics.recordSseConnectionClosed();

    const prometheusText = metrics.renderPrometheus({
      total: 3,
      active: 0,
      completed: 1,
      failed: 1,
      canceled: 1,
      rejected: 0,
      submitted: 0,
      queued: 0,
      inputRequired: 0,
      authRequired: 0,
      waitingOnExternal: 0,
      working: 0,
    });

    await telemetry.metricReader.forceFlush();
    const metricSnapshot = formatMetrics(telemetry.metricExporter);
    expect(metricSnapshot.map((metric) => metric.name)).toEqual([
      'a2a_runtime_auth_rejected_total',
      'a2a_runtime_sse_connections_active',
      'a2a_runtime_sse_connections_total',
      'a2a_runtime_sse_reconnect_total',
      'a2a_runtime_task_canceled_total',
      'a2a_runtime_task_completed_total',
      'a2a_runtime_task_created_total',
      'a2a_runtime_task_duration_ms',
      'a2a_runtime_task_failed_total',
      'a2a_runtime_task_started_total',
    ]);
    expect(metricSnapshot).toMatchSnapshot('runtime otel metrics');
    expect(prometheusText).toMatchSnapshot('runtime prometheus metrics');
  });
});
