# Official SDK interoperability

A2A Mesh maintains two intentionally separate interoperability layers. Neither layer depends on mutable hosted services; both run against loopback-only local processes in CI.

## Fixture replay guarantee

`pnpm run interop:lab` replays committed official-SDK fixtures and golden traces from `tests/interop/`. It is deterministic regression evidence for participant pairs, capabilities, and expected wire events. It does **not** claim that official SDK binaries executed during that run.

The fixture matrix remains in `tests/interop/matrix.json`, and its report is written to `artifacts/interop-lab/report.json`.

## Live official SDK guarantee

`pnpm run interop:live` starts pinned official SDK clients and servers against A2A Mesh participants. The live lanes execute all four directions:

| Client              | Server              | Verified flows                                                                                      |
| ------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `@a2a-js/sdk@1.0.0` | A2A Mesh            | Agent Card discovery, authentication challenge/retry, blocking submission, task retrieval, artifact |
| A2A Mesh            | `@a2a-js/sdk@1.0.0` | streaming submitted/working/artifact/completed events and final task retrieval                      |
| `a2a-sdk==1.1.2`    | A2A Mesh            | task creation, retrieval, and cancellation                                                          |
| A2A Mesh            | `a2a-sdk==1.1.2`    | blocking and streaming completion, terminal task state, artifact                                    |

The live protocol target is `1.0`. A deliberate unsupported-version scenario must fail with a bounded diagnostic. Credentials are supplied only through process environment, and generated diagnostics redact authorization headers, API keys, cookies, and explicit secret values while bounding each captured stream to 16 KiB.

Pinned versions are reviewed in `tests/interop/live/versions.json`:

- Node.js `24.16.0`
- Python `3.13.14`
- `@a2a-js/sdk@1.0.0`
- `a2a-sdk==1.1.2`

Run one ecosystem locally with:

```bash
pnpm run interop:live -- --ecosystem javascript
A2A_INTEROP_PYTHON=/path/to/python pnpm run interop:live -- --ecosystem python
```

Run manifest-only validation with `pnpm run interop:live:check`.

## CI evidence and reliability policy

`.github/workflows/interop-lab.yml` runs nightly, manually, and for relevant pull requests. It exposes distinct checks named `Interop Lab / official SDK fixture replay`, `Interop Lab / live official JavaScript SDK`, and `Interop Lab / live official Python SDK`. Each live job uploads its own JSON report and redacted failure diagnostics with `if: always()`.

The live lane becomes part of the stable required-summary policy only after seven consecutive scheduled runs succeed with no infrastructure-only retry and the same pinned manifest. Any SDK, runtime, protocol, orchestration, or timeout change resets that observation window. Until then, fixture replay remains the deterministic required regression layer and the live jobs provide release-readiness evidence.
