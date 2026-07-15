# @a2amesh/cli

Publishes the `a2amesh` binary for validation, discovery, messaging, registry management, monitoring, benchmarking, diagnostics, and scaffolding.

## Commands

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `benchmark`         | Run request benchmarks against an A2A endpoint    |
| `conformance`       | Run the A2A conformance fixture suite             |
| `conformance-badge` | Generate a conformance badge SVG from a report    |
| `discover`          | Resolve and print an endpoint Agent Card          |
| `doctor`            | Print local CLI diagnostics                       |
| `export-card`       | Export an endpoint Agent Card to JSON             |
| `health`            | Check an A2A endpoint health route                |
| `monitor`           | Poll task status snapshots                        |
| `registry`          | Start, inspect, export, and import registry state |
| `release-check`     | Check release readiness                           |
| `scaffold`          | Create an A2A agent project scaffold              |
| `send`              | Send a text message to an A2A endpoint            |
| `task`              | Run task lifecycle operations                     |
| `validate`          | Validate an Agent Card file or endpoint           |

Run `a2amesh <command> --help` for usage and options.

## Exit codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| `0`  | Success                              |
| `1`  | Command error or conformance failure |

See [Compatibility](../../docs/compatibility.md) for supported Node.js, protocol, transport, package, and peer ranges.

## Network policy

Network commands use the shared outbound policy. Loopback URLs are accepted for local
workflows, while other private-network destinations require the explicit
`--allow-private-network` flag. Redirects are revalidated, DNS is pinned to the validated
address set, response bodies are bounded, and URL query values and credentials are
redacted from telemetry.

`--timeout-ms` is a total operation deadline. `--retries` applies only to idempotent
requests or requests carrying an `Idempotency-Key`; ordinary message-send POSTs are not
replayed automatically.
