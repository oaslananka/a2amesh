# a2amesh init

<!-- Synced from scripts/generate-command-docs.mjs. -->

Creates a new A2A Mesh agent project from the stable runtime template, with optional auth, rate limiting, and Dockerfile output.

## Usage

```text
Usage: a2amesh init|scaffold [options] <agent-name>

Creates a new A2A Mesh agent project from the stable runtime template, with optional auth, rate
limiting, and Dockerfile output.

Options:
  --adapter <adapter>  Template type (custom is the stable alpha option) (default: "custom")
  --auth               Include API key authentication
  --rate-limit         Include explicit rate limit configuration
  --docker             Include Dockerfile
  -h, --help           display help for command
```

## Examples

### Initialize an agent project. (Linux/macOS)

```bash
a2amesh init demo-agent
```

### Initialize an agent project. (PowerShell)

```powershell
a2amesh init demo-agent
```

### Initialize an agent with auth and Docker support. (Linux/macOS)

```bash
a2amesh init secure-agent --auth --docker
```

### Initialize an agent with auth and Docker support. (PowerShell)

```powershell
a2amesh init secure-agent --auth --docker
```
