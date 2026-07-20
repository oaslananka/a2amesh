# A2A Mesh Helm chart

This chart installs the A2A Mesh registry and, when explicitly enabled, the multi-agent runtime demo.

## Security defaults

The default profile installs only the registry. It uses a `ClusterIP` Service, requires control-plane authentication, creates a release-scoped bearer token, runs as UID/GID `10001:10001`, disables service-account token mounting, drops all Linux capabilities, uses a read-only root filesystem, configures resource bounds and health probes, and creates ingress and egress NetworkPolicies.

The runtime demo is disabled by default because it requires provider credentials and exposes unauthenticated agent endpoints. Ingress is also disabled. Runtime ingress requires an explicit acknowledgement value and TLS unless insecure HTTP is separately acknowledged.

## Profiles

| File                      | Intended use                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `values.yaml`             | Secure registry-only defaults with ephemeral in-memory storage.                                                                                                      |
| `values-dev.yaml`         | Local development profile with the runtime enabled and NetworkPolicy disabled. The included credentials are placeholders.                                            |
| `values-single-node.yaml` | One registry replica with SQLite, trust-log persistence, a PVC, and an external provider Secret.                                                                     |
| `values-production.yaml`  | Production baseline with existing Secrets, immutable image digest placeholders, SQLite persistence, a single runtime replica, disruption budgets, and NetworkPolicy. |
| `ci/values-kind.yaml`     | Deterministic local-image profile used by the Kind lifecycle workflow.                                                                                               |

## Install

Render and validate before applying:

```bash
export HELM_BIN=/absolute/path/to/helm
pnpm run helm:check

helm template a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --values deploy/helm/a2amesh/values-production.yaml
```

Create the external Secrets referenced by the production profile:

```bash
kubectl create namespace a2amesh

kubectl create secret generic a2amesh-registry-auth \
  --namespace a2amesh \
  --from-literal=token='<high-entropy-registry-token>'

kubectl create secret generic a2amesh-provider-secret \
  --namespace a2amesh \
  --from-literal=openai-api-key='<provider-key>'
```

Replace both all-zero digest placeholders in `values-production.yaml` with the immutable runtime and registry digests emitted by the `Containers` workflow. Then install:

```bash
helm upgrade --install a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --create-namespace \
  --values deploy/helm/a2amesh/values-production.yaml \
  --wait \
  --timeout 10m
```

Run the chart smoke test:

```bash
helm test a2amesh --namespace a2amesh --logs --timeout 5m
```

## Authentication

Static token mode is the default. The chart can generate and retain a release-scoped token, or reference an existing Secret. The runtime reads the same token and sends it as a bearer credential when registering agents and sending heartbeats.

For an isolated development-only registry without authentication, set both `registry.auth.require=false` and `registry.auth.createSecret=false`, and leave `existingSecret` and OIDC disabled. The chart rejects contradictory combinations so a configured credential cannot be mistaken for an unauthenticated deployment.

For JWT or OIDC verification, configure `registry.auth.oidc`. Set either `discoveryUrl` or `jwksUri`, restrict `allowedHostnames`, and configure issuer, audiences, and algorithms. Static-token settings are rejected when OIDC is enabled. A runtime that registers against an OIDC-protected registry must receive a bearer token through `runtime.registry.existingAuthSecret`; token issuance and rotation remain the operator's responsibility.

The registry takes tenant identity from verified JWT claims in JWT/OIDC mode. In static-token mode, the runtime sends `x-tenant-id` and `x-principal-id` from `runtime.registry.tenantId` and `runtime.registry.principalId`.

## Storage and scaling

`memory` is the default registry backend and is appropriate only for ephemeral or single-replica deployments. Registry autoscaling requires the explicit `allowEphemeralReplicas` acknowledgement because replicas do not share memory state.

`sqlite` stores agents and distributed polling leases in the configured database and can persist the trust log in a second SQLite database. SQLite mode supports exactly one registry replica. Enabling the chart PVC converts the registry workload to a StatefulSet and mounts `/var/lib/a2amesh`. The StatefulSet uses a separate headless governing Service, while the regular registry `ClusterIP` remains the stable client endpoint.

A multi-replica registry requires a shared external storage backend. The current chart rejects multi-replica SQLite and does not claim shared-storage semantics for SQLite files.

The demo runtime also keeps task state in-process. More than one runtime replica, including HPA, is rejected unless `runtime.autoscaling.allowEphemeralReplicas=true` explicitly acknowledges that requests can be routed to pods that do not share task state. The production profile therefore uses one runtime replica.

## Network boundaries

NetworkPolicy is enabled by default. It allows DNS, runtime-to-registry traffic, registry health polling of chart runtime pods, and optional internet egress. Runtime internet egress excludes private, loopback, link-local, carrier-grade NAT, and metadata address ranges. Registry internet egress is disabled unless explicitly enabled.

Ingress controllers and external observability collectors vary by cluster. Add their namespace and pod selectors through `networkPolicy.registry.extraIngress`, `networkPolicy.registry.extraEgress`, `networkPolicy.runtime.extraIngress`, or `networkPolicy.runtime.extraEgress`. Do not disable NetworkPolicy solely to make an ingress controller work.

The registry outbound application policy also requires an exact hostname allowlist. The chart adds the runtime Service hostname automatically; add external agents through `registry.outboundPolicy.allowedHostnames`.

## Telemetry

Set `telemetry.enabled=true` and configure an OTLP HTTP endpoint. Both workloads emit traces and metrics through the shared telemetry bootstrap. The registry and runtime also expose Prometheus text endpoints at `/metrics`; keep those Services private or protect them at the cluster boundary.

## Upgrade and rollback

Preview changes:

```bash
helm diff upgrade a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --values deploy/helm/a2amesh/values-production.yaml
```

Apply an upgrade:

```bash
helm upgrade a2amesh deploy/helm/a2amesh \
  --namespace a2amesh \
  --values deploy/helm/a2amesh/values-production.yaml \
  --wait \
  --timeout 10m
```

List revisions and roll back:

```bash
helm history a2amesh --namespace a2amesh
helm rollback a2amesh <revision> --namespace a2amesh --wait --timeout 10m
helm test a2amesh --namespace a2amesh --logs
```

Chart-managed static tokens are retained across upgrades through a Secret lookup. Changes to externally managed Secrets do not automatically change pod environment variables; rotate the Secret and restart the affected workload.

## CI contract

The `Helm` workflow checks five profiles with Helm, validates rendered resources against Kubernetes schemas, scans the manifests with Trivy, packages the chart, builds local runtime and registry images, installs them into a digest-pinned Kind node, verifies health and metrics, runs `helm test`, performs an upgrade, and rolls back to the initial revision.
