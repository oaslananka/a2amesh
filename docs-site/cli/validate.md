# a2amesh validate

<!-- Synced from scripts/generate-command-docs.mjs. -->

Validates an Agent Card from a local JSON file or by resolving an HTTP endpoint Agent Card.

## Usage

```text
Usage: a2amesh validate [options] <target>

Validates an Agent Card from a local JSON file or by resolving an HTTP endpoint Agent Card.

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

### Validate a local Agent Card file. (Linux/macOS)

```bash
a2amesh validate ./agent-card.json
```

### Validate a local Agent Card file. (PowerShell)

```powershell
a2amesh validate .\agent-card.json
```

### Validate an endpoint Agent Card with a timeout. (Linux/macOS)

```bash
a2amesh validate http://127.0.0.1:3000 --timeout-ms 1000
```

### Validate an endpoint Agent Card with a timeout. (PowerShell)

```powershell
a2amesh validate http://127.0.0.1:3000 --timeout-ms 1000
```
