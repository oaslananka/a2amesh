# Production deployment pack

This pack adds a starter deployment and observability baseline for A2A Mesh operators.

## Contents

| Path                                 | Purpose                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| `deploy/<chart>/a2amesh/Chart.yaml`  | Deployment chart metadata.                                  |
| `deploy/<chart>/a2amesh/values.yaml` | Default deployment values.                                  |
| `ops/prometheus/a2amesh-alerts.yml`  | Starter alert rules for registry health and request errors. |
| `ops/grafana/a2amesh-dashboard.json` | Starter Grafana dashboard JSON.                             |
| `ops/otel/collector.yaml`            | OpenTelemetry collector example.                            |
| `scripts/check-ops-pack.mjs`         | CI-friendly validation for the operations pack.             |

Run the validation with:

```bash
pnpm run ops:check
```

The first iteration keeps container publishing and chart templating intentionally minimal. Runtime-specific image names, ingress, TLS, and storage backends should be supplied by the deployment environment.
