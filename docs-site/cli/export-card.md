# a2amesh export-card

<!-- Synced from scripts/generate-command-docs.mjs. -->

Resolves an endpoint Agent Card and writes the normalized card document to a local JSON file.

## Usage

```text
Usage: a2amesh export-card [options] <url>

Resolves an endpoint Agent Card and writes the normalized card document to a local JSON file.

Options:
  --output <path>          Output path (default: "agent-card.json")
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

### Export an Agent Card to a file. (Linux/macOS)

```bash
a2amesh export-card http://127.0.0.1:3000 --output ./agent-card.json
```

### Export an Agent Card to a file. (PowerShell)

```powershell
a2amesh export-card http://127.0.0.1:3000 --output .\agent-card.json
```
