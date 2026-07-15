# Production deployment pack

A2A Mesh provides separate production container images for the multi-agent runtime demo and the registry service. The images are built from digest-pinned Node bases, use multi-stage builds, contain only compiled runtime artifacts and production dependencies, and run as UID/GID `10001:10001`.

## Container images

| Service  | Image                                 | Default ports          | Health endpoint         |
| -------- | ------------------------------------- | ---------------------- | ----------------------- |
| Runtime  | `ghcr.io/oaslananka/a2amesh-runtime`  | `3001`, `3002`, `3003` | `GET /health` on `3003` |
| Registry | `ghcr.io/oaslananka/a2amesh-registry` | `3099`                 | `GET /health`           |

Use immutable digest references in production:

```text
ghcr.io/oaslananka/a2amesh-runtime@sha256:<digest>
ghcr.io/oaslananka/a2amesh-registry@sha256:<digest>
```

Version tags are published for discovery, but deployment manifests should resolve and pin the digest emitted by the `Containers` workflow.

## Local builds

Build from the repository root so the complete pnpm workspace graph and lockfile are available:

```bash
docker build -f apps/demo/Dockerfile -t a2amesh-runtime:local .
docker build -f packages/registry/Dockerfile -t a2amesh-registry:local .
```

Both Dockerfiles perform a filtered `pnpm install --frozen-lockfile`, build the required workspace dependency graph, create an isolated `pnpm deploy --prod` output, and prune source files, source maps, TypeScript declarations, lockfiles, caches, and build metadata before the final stage.

## Runtime environment

| Variable                 | Required | Default                 | Purpose                                                      |
| ------------------------ | -------- | ----------------------- | ------------------------------------------------------------ |
| `OPENAI_API_KEY`         | Yes      | —                       | Provider credential used by the demo agents.                 |
| `REGISTRY_URL`           | No       | `http://localhost:3099` | Registry endpoint.                                           |
| `REGISTRY_TOKEN`         | No       | —                       | Bearer token used for registry control-plane requests.       |
| `RUN_EMBEDDED_REGISTRY`  | No       | Auto for local registry | Start an in-process registry when the registry URL is local. |
| `ALLOW_PRIVATE_NETWORKS` | No       | `false`                 | Permit private-network registry and agent URLs.              |
| `PORT_RESEARCHER`        | No       | `3001`                  | Researcher listener port.                                    |
| `PORT_WRITER`            | No       | `3002`                  | Writer listener port.                                        |
| `PORT_ORCHESTRATOR`      | No       | `3003`                  | Orchestrator listener and health port.                       |
| `RESEARCHER_URL`         | No       | `http://localhost:3001` | Advertised researcher URL.                                   |
| `WRITER_URL`             | No       | `http://localhost:3002` | Advertised writer URL.                                       |
| `ORCHESTRATOR_URL`       | No       | `http://localhost:3003` | Advertised orchestrator URL.                                 |

## Registry environment

| Variable                     | Required   | Default               | Purpose                                                                                                        |
| ---------------------------- | ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PORT`                       | No         | `3099`                | Registry listener port.                                                                                        |
| `REGISTRY_TOKEN`             | Production | —                     | Enables bearer-token protection for control-plane mutations.                                                   |
| `REGISTRY_ALLOWED_ORIGINS`   | Production | —                     | Comma-separated CORS allowlist.                                                                                |
| `REGISTRY_REQUIRE_ORIGIN`    | No         | `false`               | Require an `Origin` header on control-plane requests. Set to `true` for browser-facing production deployments. |
| `ALLOW_LOCALHOST`            | No         | `false` in production | Permit localhost agent URLs.                                                                                   |
| `ALLOW_PRIVATE_NETWORKS`     | No         | `false`               | Permit private-network agent URLs.                                                                             |
| `ALLOW_UNRESOLVED_HOSTNAMES` | No         | `false`               | Permit unresolved agent hostnames.                                                                             |

## Read-only and non-root operation

The supported production security profile is:

```bash
docker run --rm \
  --user 10001:10001 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  ghcr.io/oaslananka/a2amesh-registry@sha256:<digest>
```

The images do not require writes to the root filesystem. Supply an explicit writable volume only when a future storage backend requires one; do not make the entire root filesystem writable.

## Compose profiles

`compose.dev.yaml` is a development convenience. It builds from the local source tree, exposes all demo ports, and uses development-oriented defaults.

`deploy/compose.production.yaml` is the production example. It requires digest-pinned image variables, enables a read-only root filesystem, drops Linux capabilities, sets `no-new-privileges`, binds published ports to loopback, and requires registry authentication/origin configuration.

```bash
export A2AMESH_RUNTIME_IMAGE='ghcr.io/oaslananka/a2amesh-runtime@sha256:<digest>'
export A2AMESH_REGISTRY_IMAGE='ghcr.io/oaslananka/a2amesh-registry@sha256:<digest>'
export OPENAI_API_KEY='...'
export REGISTRY_TOKEN='...'
export REGISTRY_ALLOWED_ORIGINS='https://operator.example.com'
docker compose -f deploy/compose.production.yaml up -d
```

## CI, scanning, and publication

The `Containers` workflow performs the following for both images on relevant pull requests and `main` pushes:

1. Clean BuildKit build from the repository checkout.
2. OCI label, non-root user, and filesystem-content inspection.
3. Startup/API smoke test with a read-only root filesystem, dropped capabilities, and `no-new-privileges`.
4. Trivy configuration and vulnerability scans. Fixable `HIGH` and `CRITICAL` findings fail the workflow.
5. OCI-layout verification that BuildKit produced SPDX SBOM and SLSA provenance attestations.

Manual publication requires an exact runtime release tag and confirmation string. The workflow pushes version and immutable revision tags to GHCR, records the registry digest, attaches BuildKit SBOM/provenance, and publishes GitHub build-provenance attestations against the image digest.

Verify a published image with:

```bash
docker buildx imagetools inspect \
  ghcr.io/oaslananka/a2amesh-registry@sha256:<digest>

gh attestation verify \
  oci://ghcr.io/oaslananka/a2amesh-registry@sha256:<digest> \
  --repo oaslananka/a2amesh
```

## Operations pack

| Path                                 | Purpose                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| `deploy/compose.production.yaml`     | Hardened production Compose example.                        |
| `ops/prometheus/a2amesh-alerts.yml`  | Starter alert rules for registry health and request errors. |
| `ops/grafana/a2amesh-dashboard.json` | Starter Grafana dashboard JSON.                             |
| `ops/otel/collector.yaml`            | OpenTelemetry collector example.                            |
| `scripts/check-ops-pack.mjs`         | CI-friendly validation for the operations pack.             |

Run static deployment validation with:

```bash
pnpm run ops:check
```
