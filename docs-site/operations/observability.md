# Operator Observability

A2A Mesh publishes a small, stable observability pack for operators. The pack is intentionally usable without vendor-specific services: Prometheus scrapes the runtime and registry endpoints, Grafana imports the starter dashboard, and incident responders can attach a redacted diagnostic bundle.

## Shipped assets

| Asset | Purpose |
| --- | --- |
| `ops/grafana/a2amesh-dashboard.json` | Starter Grafana dashboard for runtime task flow, task duration, and registry health. |
| `ops/prometheus/a2amesh-alerts.yml` | Starter recording and alerting rules for runtime failure ratio, auth rejection spikes, SSE pressure, and registry health. |
| `ops/otel/collector.yaml` | Minimal OpenTelemetry collector pipeline for local trace and metric export testing. |
| `ops/diagnostics/bundle-manifest.json` | Required file list and redaction contract for diagnostic bundles. |
| `ops/diagnostics/README.md` | Bundle collection and sharing rules for operators. |

## Scrape targets

| Component | Endpoint | Format | Notes |
| --- | --- | --- | --- |
| Runtime | `/metrics` | Prometheus text | Runtime task counters, duration histogram, SSE gauges, and auth rejection counters. |
| Runtime | `/health` | JSON | Production-safe health output. Set `A2AMESH_HEALTH_DETAIL=detailed` only when detailed local diagnostics are needed. |
| Registry | `/metrics` | Prometheus text | Registry registration, search, heartbeat, agent, tenant, and public-agent metrics. |
| Registry | `/metrics/summary` | JSON | Compact summary for diagnostics and support bundles. |

## Semantic conventions

Use these names and labels as the stable operational surface. Changes require telemetry snapshot updates and operator documentation updates.

### Runtime metrics

| Metric | Type | Required labels | SLO use |
| --- | --- | --- | --- |
| `a2a_runtime_task_started_total` | Counter | `service_name`, `service_version` | Throughput denominator. |
| `a2a_runtime_task_completed_total` | Counter | `service_name`, `service_version` | Successful task throughput. |
| `a2a_runtime_task_failed_total` | Counter | `service_name`, `service_version` | Failure-ratio numerator. |
| `a2a_runtime_task_canceled_total` | Counter | `service_name`, `service_version` | Cancellation tracking. |
| `a2a_runtime_task_duration_ms` | Histogram | `service_name`, `service_version`, `le` | Latency SLO and p95/p99 dashboards. |
| `a2a_runtime_tasks_active` | Gauge | `service_name`, `service_version` | Saturation and stuck-task detection. |
| `a2a_runtime_sse_connections_active` | Gauge | `service_name`, `service_version` | Streaming pressure. |
| `a2a_runtime_sse_reconnect_total` | Counter | `service_name`, `service_version` | Streaming instability. |
| `a2a_runtime_auth_rejected_total` | Counter | `service_name`, `service_version` | Auth and policy rejection monitoring. |

### Registry metrics

| Metric | Type | Required labels | SLO use |
| --- | --- | --- | --- |
| `a2a_registry_registrations_total` | Counter | none | Registration throughput. |
| `a2a_registry_searches_total` | Counter | none | Discovery traffic. |
| `a2a_registry_heartbeats_total` | Counter | none | Agent liveness traffic. |
| `a2a_registry_agents` | Gauge | none | Registry inventory. |
| `a2a_registry_healthy_agents` | Gauge | none | Registry availability proxy. |
| `a2a_registry_active_tenants` | Gauge | none | Tenant footprint. |
| `a2a_registry_public_agents` | Gauge | none | Public discovery surface. |

## Starter SLOs

These starter SLOs are examples. Tune targets by deployment size, task complexity, and business criticality before paging humans.

| SLO | Example target | PromQL sketch |
| --- | --- | --- |
| Runtime task success ratio | `>= 99%` over 30 days | `1 - (sum(rate(a2a_runtime_task_failed_total[30d])) / clamp_min(sum(rate(a2a_runtime_task_started_total[30d])), 1))` |
| Runtime task latency | p95 `< 5s` over 7 days | `histogram_quantile(0.95, sum by (le) (rate(a2a_runtime_task_duration_ms_bucket[7d])))` |
| Registry healthy-agent ratio | `>= 95%` over 24 hours | `sum(a2a_registry_healthy_agents) / clamp_min(sum(a2a_registry_agents), 1)` |
| Streaming stability | reconnect rate `< 0.1/s` over 1 hour | `sum(rate(a2a_runtime_sse_reconnect_total[1h]))` |

## Diagnostic bundle procedure

1. Capture runtime `/health` and `/metrics`.
2. Capture registry `/metrics` and `/metrics/summary` when a registry is involved.
3. Add package version, git commit, deployment environment name, and collector configuration.
4. Redact credential-like values, cookies, webhook tokens, private URLs, and raw task input values.
5. Validate the final bundle against `ops/diagnostics/bundle-manifest.json`.
6. Store the bundle with a short retention window. The starter recommendation is 14 days.

A diagnostic bundle is evidence, not a dump. Prefer summaries, hashes, counters, and redacted snippets over raw logs.

## Verification commands

```bash
pnpm run ops:check
pnpm run lint:md
```
