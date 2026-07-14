# a2amesh send

<!-- Synced from scripts/generate-command-docs.mjs. -->

Sends a text message to an A2A endpoint and emits the resulting task response.

## Usage

```text
Usage: a2amesh send [options] <url> <message>

Sends a text message to an A2A endpoint and emits the resulting task response.

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

### Send a text message. (Linux/macOS)

```bash
a2amesh send http://127.0.0.1:3000 "hello"
```

### Send a text message. (PowerShell)

```powershell
a2amesh send http://127.0.0.1:3000 "hello"
```

### Send with bearer authentication. (Linux/macOS)

```bash
a2amesh send http://127.0.0.1:3000 "hello" --bearer-token "$A2A_TOKEN"
```

### Send with bearer authentication. (PowerShell)

```powershell
a2amesh send http://127.0.0.1:3000 "hello" --bearer-token $env:A2A_TOKEN
```
