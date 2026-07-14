# a2amesh discover

<!-- Synced from scripts/generate-command-docs.mjs. -->

Discovers an A2A endpoint Agent Card and prints human-readable details or machine-readable JSON.

## Usage

```text
Usage: a2amesh discover [options] <url>

Discovers an A2A endpoint Agent Card and prints human-readable details or machine-readable JSON.

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

### Discover an Agent Card. (Linux/macOS)

```bash
a2amesh discover http://127.0.0.1:3000
```

### Discover an Agent Card. (PowerShell)

```powershell
a2amesh discover http://127.0.0.1:3000
```

### Discover with tenant and request headers. (Linux/macOS)

```bash
a2amesh discover http://127.0.0.1:3000 --header "x-tenant:demo" --request-id "req-1"
```

### Discover with tenant and request headers. (PowerShell)

```powershell
a2amesh discover http://127.0.0.1:3000 --header "x-tenant:demo" --request-id "req-1"
```
