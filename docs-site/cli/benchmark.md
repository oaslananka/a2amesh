# a2amesh benchmark

<!-- Synced from scripts/generate-command-docs.mjs. -->

Runs a local request benchmark against an A2A endpoint and reports request counts, failures, latency, and total duration.

## Usage

```text
Usage: a2amesh benchmark [options] <url>

Runs a local request benchmark against an A2A endpoint and reports request counts, failures,
latency, and total duration.

Options:
  --requests <count>       Number of requests to send (default: "25")
  --concurrency <count>    Number of concurrent workers (default: "5")
  --message <message>      Benchmark message text (default: "benchmark ping")
  --header <key:value...>  HTTP header to send; accepts one or more key:value entries
  --bearer-token <token>   Bearer token sent as Authorization: Bearer <token>
  --api-key <name:value>   API key header as name:value; repeat for multiple keys
  --timeout-ms <ms>        Per-request timeout in milliseconds
  --retries <count>        Retry count for transient network failures
  --request-id <id>        Request id sent as x-request-id
  --origin <url>           Origin header to send
  --allow-private-network  Allow explicitly requested private-network destinations
  -h, --help               display help for command
```

## Examples

### Run a 25 request benchmark with five concurrent workers. (Linux/macOS)

```bash
a2amesh benchmark http://127.0.0.1:3000 --requests 25 --concurrency 5
```

### Run a 25 request benchmark with five concurrent workers. (PowerShell)

```powershell
a2amesh benchmark http://127.0.0.1:3000 --requests 25 --concurrency 5
```
