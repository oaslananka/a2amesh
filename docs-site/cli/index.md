# CLI

<!-- Synced from scripts/generate-command-docs.mjs. -->

A2A Mesh developer CLI

## Usage

```text
Usage: a2amesh [options] [command]

A2A Mesh developer CLI

Options:
  -V, --version                              output the version number
  --json                                     Machine-readable JSON output
  -h, --help                                 display help for command

Commands:
  discover [options] <url>                   Resolve and print an endpoint Agent Card.
  init|scaffold [options] <agent-name>       Initialize an A2A Mesh agent project.
  task                                       Run task lifecycle operations.
  send [options] <url> <message>             Send a text message to an A2A endpoint.
  registry                                   Start, inspect, export, and import registry state.
  health [options] <url>                     Check an A2A endpoint health route.
  validate [options] <target>                Validate an Agent Card file or endpoint.
  monitor [options] <url>                    Poll task status snapshots.
  benchmark [options] <url>                  Run request benchmarks against an A2A endpoint.
  conformance-badge [options] <report-file>  Generate a conformance badge from a report JSON file.
  conformance [options] <url>                Run the A2A conformance fixture suite.
  doctor [options]                           Print local CLI diagnostics.
  release-check                              Check release readiness.
  export-card [options] <url>                Export an endpoint Agent Card to JSON.
  help [command]                             display help for command
```

## Commands

| Command                     | Summary                                               |
| --------------------------- | ----------------------------------------------------- |
| `a2amesh benchmark`         | Run request benchmarks against an A2A endpoint.       |
| `a2amesh conformance`       | Run the A2A conformance fixture suite.                |
| `a2amesh conformance-badge` | Generate a conformance badge from a report JSON file. |
| `a2amesh discover`          | Resolve and print an endpoint Agent Card.             |
| `a2amesh doctor`            | Print local CLI diagnostics.                          |
| `a2amesh export-card`       | Export an endpoint Agent Card to JSON.                |
| `a2amesh health`            | Check an A2A endpoint health route.                   |
| `a2amesh init`              | Initialize an A2A Mesh agent project.                 |
| `a2amesh monitor`           | Poll task status snapshots.                           |
| `a2amesh registry`          | Start, inspect, export, and import registry state.    |
| `a2amesh release-check`     | Check release readiness.                              |
| `a2amesh send`              | Send a text message to an A2A endpoint.               |
| `a2amesh task`              | Run task lifecycle operations.                        |
| `a2amesh validate`          | Validate an Agent Card file or endpoint.              |

## Shared Network Options

Network commands accept the same request options where applicable: `--header <key:value...>`, `--bearer-token <token>`, `--api-key <name:value>`, `--timeout-ms <ms>`, `--retries <count>`, `--request-id <id>`, and `--origin <url>`.

Secret-bearing values are sent in request headers only; JSON output and validation errors must not echo bearer tokens, API key values, or full auth headers.
