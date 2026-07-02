# Official SDK interop lab

The interop lab is the repeatable compatibility gate for A2A Mesh and the official A2A SDK ecosystem. It starts as a fixture replay suite so every pull request can validate the same protocol traces without depending on external services.

Run it locally with:

```bash
pnpm run interop:lab
```

For CI-style validation without writing a report artifact, run:

```bash
pnpm run interop:check
```

## Matrix

The matrix lives in `tests/interop/matrix.json` and currently tracks the `official-a2a-v1.0` profile.

| Client                   | Server                   |
| ------------------------ | ------------------------ |
| `official-js-client`     | `a2amesh-server`         |
| `a2amesh-client`         | `official-js-server`     |
| `official-python-client` | `a2amesh-server`         |
| `a2amesh-client`         | `official-python-server` |
| `a2amesh-registry`       | `official-js-server`     |
| `a2amesh-registry`       | `official-python-server` |

Required capabilities include message send, message stream, task lifecycle, cancellation, callback configuration, challenge handling, version negotiation, extension negotiation, and registry discovery.

## Golden traces

Golden traces live under `tests/interop/golden-traces/`. The runner validates that each scenario:

1. references known participants;
2. covers required matrix capabilities;
3. has a trace matching the scenario id, client, server, and profile;
4. includes protocol events expected for each declared capability.

The default run writes `artifacts/interop-lab/report.json`. The report is ignored by git and uploaded by the nightly workflow.

## Nightly workflow

`.github/workflows/interop-lab.yml` runs the matrix on a nightly schedule, on manual dispatch, and on pull requests that change the lab, docs, or workflow. The current job is fixture based. Future live SDK containers should feed traces into the same matrix instead of creating a separate compatibility surface.

## Adding live SDK containers

When official SDK container fixtures are added, keep the contract stable:

1. write the observed trace to the matching scenario artifact;
2. keep `tests/interop/matrix.json` as the source of truth for participants and capabilities;
3. run `pnpm run interop:lab` after trace generation;
4. fail CI when a required pair or capability is not covered.
