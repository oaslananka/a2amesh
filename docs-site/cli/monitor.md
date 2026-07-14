# a2amesh monitor

<!-- Synced from scripts/generate-command-docs.mjs. -->

Polls task status snapshots from an A2A endpoint and emits task state summaries for each cycle.

## Usage

```text
Usage: a2amesh monitor [options] <url>

Polls task status snapshots from an A2A endpoint and emits task state summaries for each cycle.

Options:
  --interval <ms>           Polling interval in milliseconds (default: "2000")
  --cycles <count>          Number of polling cycles before exit
  --limit <count>           Number of tasks to fetch (default: "50")
  --context-id <contextId>  Filter tasks by context id
  --header <key:value...>   HTTP header to send; accepts one or more key:value entries
  --bearer-token <token>    Bearer token sent as Authorization: Bearer <token>
  --api-key <name:value>    API key header as name:value; repeat for multiple keys
  --timeout-ms <ms>         Per-request timeout in milliseconds
  --retries <count>         Retry count for transient network failures
  --request-id <id>         Request id sent as x-request-id
  --origin <url>            Origin header to send
  --allow-private-network   Allow explicitly requested private-network destinations
  -h, --help                display help for command
```

## Examples

### Poll three task status snapshots. (Linux/macOS)

```bash
a2amesh monitor http://127.0.0.1:3000 --cycles 3
```

### Poll three task status snapshots. (PowerShell)

```powershell
a2amesh monitor http://127.0.0.1:3000 --cycles 3
```
