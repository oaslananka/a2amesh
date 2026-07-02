# Telemetry

A2A Mesh uses [OpenTelemetry](https://opentelemetry.io/) for distributed tracing, metrics, and context propagation.

## Enabling Telemetry

Telemetry is opt-in. Set the `A2A_TELEMETRY_ENABLED` environment variable to `true`:

```bash
export A2A_TELEMETRY_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

PowerShell:

```powershell
$env:A2A_TELEMETRY_ENABLED = 'true'
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
```

## Server Telemetry Middleware

The `createTelemetryContextMiddleware()` is automatically registered in `A2AServer`. It extracts incoming W3C `traceparent`, `tracestate`, and `baggage` headers from each HTTP request and sets the active OpenTelemetry context before route handlers execute.

This means downstream spans — including `a2a.handleRpc`, `a2a.processTask`, `http.request`, and `sse.sendEvent` — are automatically parented to the incoming trace context when incoming headers carry a valid trace.

## Client Propagation

`A2AClient` injects `traceparent` and `tracestate` headers into all outgoing JSON-RPC requests so downstream agents can continue the distributed trace.

```typescript
import { A2AClient } from '@a2amesh/runtime';

const client = new A2AClient('https://agent.example');
// Outbound requests automatically include trace context headers
```

## Context Helpers

### `withA2ABaggage(taskId?, contextId?, activeContext?)`

Returns a new `Context` with A2A-specific baggage entries (`a2a.task_id`, `a2a.context_id`). Use it to propagate task context across service boundaries:

```typescript
import { context } from '@opentelemetry/api';
import { withA2ABaggage } from '@a2amesh/runtime';

const ctx = withA2ABaggage('task-123', 'session-456');
context.with(ctx, () => {
  // Outbound calls will carry a2a.task_id and a2a.context_id in baggage
});
```

### `extractA2AContext(headers)`

Extracts trace context and baggage from incoming headers (e.g., HTTP `IncomingHttpHeaders`):

```typescript
import { extractA2AContext } from '@a2amesh/runtime';

const ctx = extractA2AContext(req.headers);
```

## Configuration Reference

| Environment variable                 | Default            | Description                               |
| ------------------------------------ | ------------------ | ----------------------------------------- |
| `A2A_TELEMETRY_ENABLED`              | `false`            | Enable OpenTelemetry tracing and metrics  |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | —                  | OTLP HTTP endpoint for traces and metrics |
| `OTEL_TRACES_SAMPLER_ARG`            | `1`                | Trace sample ratio (0.0–1.0)              |
| `A2A_OTEL_METRIC_EXPORT_INTERVAL_MS` | `10000`            | Metric export interval in milliseconds    |
| `OTEL_SERVICE_NAME`                  | `@a2amesh/runtime` | Service name for resource attributes      |
| `DEPLOYMENT_ENVIRONMENT`             | `NODE_ENV`         | Deployment environment label              |

## Span Names

| Span name         | Location                 |
| ----------------- | ------------------------ |
| `a2a.handleRpc`   | JSON-RPC request handler |
| `a2a.processTask` | Task processing          |
| `http.request`    | Outbound HTTP requests   |
| `sse.sendEvent`   | SSE event delivery       |

## Prometheus Metrics

When telemetry is enabled, `RuntimeMetrics` exposes a Prometheus-formatted metrics endpoint at the agent card's `url` + `/metrics`.
