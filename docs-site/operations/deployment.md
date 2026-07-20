# Production deployment pack

A2A Mesh publishes separate container images for the multi-agent runtime demo and the registry service, plus a Helm chart that composes them with secure defaults. The images use digest-pinned Node bases, multi-stage builds, compiled runtime artifacts only, and UID/GID `10001:10001`.

## Container images

| Service  | Image                                 | Default ports          | Health and metrics                         |
| -------- | ------------------------------------- | ---------------------- | ------------------------------------------ |
| Runtime  | `ghcr.io/oaslananka/a2amesh-runtime`  | `3001`, `3002`, `3003` | `GET /health` and `GET /metrics` on `3003` |
| Registry | `ghcr.io/oaslananka/a2amesh-registry` | `3099`                 | `GET /health` and `GET /metrics`           |

Use immutable digest references in production:

```text
ghcr.io/oaslananka/a2amesh-runtime@sha256:<digest>
ghcr.io/oaslananka/a2amesh-registry@sha256:<digest>
```

Version tags are published for discovery. Deployment manifests should use the digests emitted by the `Containers` workflow.

## Local container builds

Build from the repository root so the complete pnpm workspace graph and lockfile are available:

```bash
docker build -f apps/demo/Dockerfile -t a2amesh-runtime:local .
docker build -f packages/registry/Dockerfile -t a2amesh-registry:local .
```

Both Dockerfiles perform a filtered frozen-lockfile install, build the required workspace dependency graph, create an isolated production deployment directory, and remove source files, source maps, TypeScript declarations, package-manager state, caches, and build metadata before the final stage.

## Helm chart

The chart is located at `deploy/helm/a2amesh`. Its default profile installs an authenticated registry behind a `ClusterIP` Service. The runtime and all ingress resources are disabled until explicitly configured.

The chart applies these defaults:

- UID/GID `10001:10001`, `runAsNonRoot`, and `RuntimeDefault` seccomp.
- Read-only root filesystems, all Linux capabilities dropped, and privilege escalation disabled.
- Service-account token automount disabled.
- Startup, readiness, and liveness probes.
- CPU and memory requests and limits.
- Registry control-plane authentication required.
- NetworkPolicy enabled with DNS and chart-internal communication only; runtime public-provider egress is explicitly bounded.
- Ingress disabled. Runtime ingress requires acknowledgement that the demo endpoint is unauthenticated.

### Supported profiles

| Profile                   | Purpose                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `values.yaml`             | Registry-only secure defaults with ephemeral memory storage.                                                                    |
| `values-dev.yaml`         | Local development with runtime enabled and placeholder credentials.                                                             |
| `values-single-node.yaml` | Single registry replica with SQLite, trust-log persistence, and a PVC.                                                          |
| `values-production.yaml`  | Existing Secrets, immutable digest placeholders, persistent SQLite, one runtime replica, disruption budgets, and NetworkPolicy. |
| `ci/values-kind.yaml`     | Local images and deterministic values for Kind lifecycle testing.                                                               |

Validate the chart locally with an absolute Helm executable path:

```bash
export HELM_BIN=/absolute/path/to/helm
pnpm run helm:check
```

The check lints and renders all five profiles and verifies negative cases such as runtime deployment without credentials, insecure ingress, unacknowledged runtime scaling, and multi-replica SQLite.

### Production installation

Create the namespace and external Secrets referenced by the production profile:

```bash
kubectl create namespace a2amesh

kubectl create secret generic a2amesh-registry-auth \
  --namespace a2amesh \
  --from-literal=token='<high-entropy-registry-token>'

kubectl create secret generic a2amesh-provider-secret \
  --namespace a2amesh \
  --from-literal=openai-api-key='<provider-key>'
```

Replace both all-zero image digest placeholders in `values-production.yaml` with the immutable digests from the `Containers` workflow. Render before applying:

```bash
helm template a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --values deploy/helm/a2amesh/values-production.yaml
```

Install or upgrade:

```bash
helm upgrade --install a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --create-namespace \
  --values deploy/helm/a2amesh/values-production.yaml \
  --wait \
  --timeout 10m

helm test a2amesh --namespace a2amesh --logs --timeout 5m
```

### Registry authentication and tenancy

Static-token mode can use a chart-managed token or an existing Secret. Chart-managed tokens are retained across upgrades. The runtime sends that token as a bearer credential and attaches its configured principal and tenant headers when registering agents and sending heartbeats.

An isolated development registry can explicitly disable authentication only by setting `registry.auth.require=false` and `registry.auth.createSecret=false` with no existing Secret or OIDC configuration. Contradictory auth values fail chart validation.

JWT and OIDC verification are configured under `registry.auth.oidc`. Supply a discovery URL or JWKS URL, expected issuer and audiences, accepted algorithms, and an exact hostname allowlist for discovery traffic. Static token and OIDC modes are mutually exclusive.

In JWT/OIDC mode, tenant identity comes from verified claims such as `tenantId`, `tenant_id`, or `org_id`. A runtime connecting to an OIDC-protected registry must receive a valid bearer token from an externally managed Secret; issuance and rotation are outside the chart.

### Storage and scaling

The default memory backend is ephemeral and intended for a single replica. Registry autoscaling requires an explicit acknowledgement because memory-backed replicas do not share state.

SQLite mode persists agents and polling leases. The optional trust-log database uses the same data volume. Enabling persistence renders the registry as a StatefulSet with a PVC mounted at `/var/lib/a2amesh`. SQLite mode is restricted to exactly one registry replica. The StatefulSet uses a separate headless governing Service; clients continue to use the regular registry `ClusterIP` Service.

A multi-replica registry requires a shared external storage design. Do not mount one SQLite file read-write into multiple registry pods.

The demo runtime keeps task state inside each process. The chart rejects multiple runtime replicas and HPA unless `runtime.autoscaling.allowEphemeralReplicas=true` explicitly accepts non-shared task state. The production profile remains at one runtime replica.

### Network boundaries and ingress

The runtime NetworkPolicy allows DNS, registry access, and internet egress that excludes loopback, private, link-local, carrier-grade NAT, and metadata ranges. Registry internet egress is off by default. The chart automatically adds the runtime Service hostname to the registry application allowlist.

Ingress controller labels and observability collector locations vary between clusters. Add explicit selectors through the `networkPolicy.*.extraIngress` and `networkPolicy.*.extraEgress` values. Keep ingress disabled until those paths are understood.

Registry ingress requires authentication and TLS unless insecure HTTP is explicitly acknowledged. Runtime ingress additionally requires `acknowledgeUnauthenticatedEndpoint=true`, because the demo runtime does not provide an inbound authentication boundary.

### Upgrade and rollback

```bash
helm history a2amesh --namespace a2amesh

helm upgrade a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --values deploy/helm/a2amesh/values-production.yaml \
  --wait \
  --timeout 10m

helm rollback a2amesh <revision> \
  --namespace a2amesh \
  --wait \
  --timeout 10m

helm test a2amesh --namespace a2amesh --logs
```

Externally managed Secret updates do not change environment variables in already running pods. Restart the affected Deployment or StatefulSet after rotating those credentials.

## Runtime environment

| Variable                      | Required   | Default                 | Purpose                                                                         |
| ----------------------------- | ---------- | ----------------------- | ------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`              | Yes        | —                       | Provider credential used by the demo agents.                                    |
| `ANTHROPIC_API_KEY`           | No         | —                       | Optional writer provider credential.                                            |
| `REGISTRY_URL`                | No         | `http://localhost:3099` | Registry endpoint.                                                              |
| `REGISTRY_TOKEN`              | Production | —                       | Bearer token used for registry control-plane requests.                          |
| `REGISTRY_TENANT_ID`          | No         | —                       | Tenant header used in static-token mode.                                        |
| `REGISTRY_PRINCIPAL_ID`       | No         | `runtime-demo`          | Principal header used in static-token mode.                                     |
| `REGISTRY_ALLOWED_HOSTNAMES`  | No         | Registry URL host       | Comma-separated exact hostname allowlist for registry requests.                 |
| `RUN_EMBEDDED_REGISTRY`       | No         | Auto for local registry | Start an in-process registry when the registry URL is local.                    |
| `ALLOW_PRIVATE_NETWORKS`      | No         | `false`                 | Permit private-network registry and agent URLs after hostname allowlist checks. |
| `PORT_RESEARCHER`             | No         | `3001`                  | Researcher listener port.                                                       |
| `PORT_WRITER`                 | No         | `3002`                  | Writer listener port.                                                           |
| `PORT_ORCHESTRATOR`           | No         | `3003`                  | Orchestrator listener, health, and metrics port.                                |
| `RESEARCHER_URL`              | No         | `http://localhost:3001` | Advertised researcher URL stored in the agent card.                             |
| `WRITER_URL`                  | No         | `http://localhost:3002` | Advertised writer URL stored in the agent card.                                 |
| `ORCHESTRATOR_URL`            | No         | `http://localhost:3003` | Advertised orchestrator URL.                                                    |
| `RESEARCHER_INTERNAL_URL`     | No         | Loopback researcher URL | Runtime-internal researcher target used by the orchestrator.                    |
| `WRITER_INTERNAL_URL`         | No         | Loopback writer URL     | Runtime-internal writer target used by the orchestrator.                        |
| `A2A_TELEMETRY_ENABLED`       | No         | `false`                 | Enable OTLP traces and metrics.                                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No         | —                       | OTLP HTTP endpoint base URL.                                                    |

## Registry environment

| Variable                              | Required                   | Default               | Purpose                                                   |
| ------------------------------------- | -------------------------- | --------------------- | --------------------------------------------------------- |
| `PORT`                                | No                         | `3099`                | Registry listener port.                                   |
| `REGISTRY_REQUIRE_AUTH`               | Production                 | `true` in production  | Require control-plane authentication.                     |
| `REGISTRY_TOKEN`                      | Static-token mode          | —                     | Bearer token for control-plane requests.                  |
| `REGISTRY_ALLOWED_ORIGINS`            | Browser-facing deployments | —                     | Comma-separated CORS allowlist.                           |
| `REGISTRY_REQUIRE_ORIGIN`             | No                         | `false`               | Require an `Origin` header on control-plane requests.     |
| `REGISTRY_OIDC_DISCOVERY_URL`         | OIDC mode                  | —                     | OIDC discovery document URL.                              |
| `REGISTRY_AUTH_JWKS_URI`              | JWT mode                   | —                     | JWKS URL used for signature verification.                 |
| `REGISTRY_AUTH_ISSUER`                | JWT/OIDC mode              | —                     | Expected token issuer.                                    |
| `REGISTRY_AUTH_AUDIENCE`              | JWT/OIDC mode              | —                     | Comma-separated accepted audiences.                       |
| `REGISTRY_AUTH_ALGORITHMS`            | JWT/OIDC mode              | `RS256,ES256`         | Accepted signature algorithms.                            |
| `REGISTRY_AUTH_ALLOWED_HOSTNAMES`     | JWT/OIDC mode              | URL hosts             | Exact discovery and JWKS hostname allowlist.              |
| `REGISTRY_STORAGE_BACKEND`            | No                         | `memory`              | `memory` or `sqlite`.                                     |
| `REGISTRY_SQLITE_PATH`                | SQLite mode                | —                     | Agent and polling-lease database path.                    |
| `REGISTRY_TRUST_LOG_PATH`             | No                         | —                     | Optional SQLite trust-log database path.                  |
| `REGISTRY_ALLOWED_HOSTNAMES`          | No                         | —                     | Exact outbound agent hostname allowlist.                  |
| `REGISTRY_DISTRIBUTED_POLLING_LEASES` | No                         | SQLite-dependent      | Coordinate polling through the configured storage.        |
| `REGISTRY_POLLING_LEASE_OWNER_ID`     | No                         | Pod/process name      | Stable lease owner identifier.                            |
| `ALLOW_LOCALHOST`                     | No                         | `false` in production | Permit localhost agent URLs.                              |
| `ALLOW_PRIVATE_NETWORKS`              | No                         | `false`               | Permit private-network agent URLs after allowlist checks. |
| `ALLOW_UNRESOLVED_HOSTNAMES`          | No                         | `false`               | Permit unresolved agent hostnames.                        |
| `A2A_TELEMETRY_ENABLED`               | No                         | `false`               | Enable OTLP traces and metrics.                           |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | No                         | —                     | OTLP HTTP endpoint base URL.                              |

## Compose profiles

`compose.dev.yaml` builds from the local source tree, exposes all demo ports, and uses development-oriented defaults.

`deploy/compose.production.yaml` requires digest-pinned image variables, enables a read-only root filesystem, drops Linux capabilities, sets `no-new-privileges`, binds published ports to loopback, and requires registry authentication configuration.

```bash
export A2AMESH_RUNTIME_IMAGE='ghcr.io/oaslananka/a2amesh-runtime@sha256:<digest>'
export A2AMESH_REGISTRY_IMAGE='ghcr.io/oaslananka/a2amesh-registry@sha256:<digest>'
export OPENAI_API_KEY='...'
export REGISTRY_TOKEN='...'
export REGISTRY_ALLOWED_ORIGINS='https://operator.example.com'
docker compose -f deploy/compose.production.yaml up -d
```

## CI, scanning, and publication

The `Containers` workflow builds and inspects both images, runs read-only non-root startup tests, scans configuration and fixable vulnerabilities, and verifies SPDX SBOM and SLSA provenance attestations.

The `Helm` workflow:

1. Lints and renders every supported profile.
2. Validates rendered resources against Kubernetes OpenAPI schemas.
3. Runs Trivy configuration scanning on the rendered manifests.
4. Packages the chart.
5. Builds local runtime and registry images.
6. Installs them into a digest-pinned Kind cluster.
7. Verifies health and Prometheus metrics and runs the Helm test hook.
8. Performs an upgrade and rollback and repeats the smoke test.

Manual container publication requires an exact runtime release tag and confirmation string. The workflow pushes version and immutable revision tags, records registry digests, and publishes attestations against each image digest.

## Operations pack

| Path                                 | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `deploy/helm/a2amesh`                | Helm chart, values schema, profiles, and smoke test.         |
| `deploy/compose.production.yaml`     | Hardened production Compose example.                         |
| `ops/prometheus/a2amesh-alerts.yml`  | Starter alert rules for registry health and request errors.  |
| `ops/grafana/a2amesh-dashboard.json` | Starter Grafana dashboard JSON.                              |
| `ops/otel/collector.yaml`            | OpenTelemetry collector example.                             |
| `scripts/check-ops-pack.mjs`         | Static validation for the operations pack.                   |
| `scripts/check-helm-chart.mjs`       | Helm lint, render, secure-default, and negative-case checks. |

Run static deployment validation with:

```bash
pnpm run ops:check
```
