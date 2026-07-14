# a2amesh health

<!-- Synced from scripts/generate-command-docs.mjs. -->

Checks an A2A endpoint health route and emits the health response.

## Usage

```text
Usage: a2amesh health [options] <url>

Checks an A2A endpoint health route and emits the health response.

Options:
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

### Check endpoint health with a short timeout. (Linux/macOS)

```bash
a2amesh health http://127.0.0.1:3000 --timeout-ms 1000 --json
```

### Check endpoint health with a short timeout. (PowerShell)

```powershell
a2amesh health http://127.0.0.1:3000 --timeout-ms 1000 --json
```
