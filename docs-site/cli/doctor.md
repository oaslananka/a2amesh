# a2amesh doctor

<!-- Synced from scripts/generate-command-docs.mjs. -->

Prints local CLI diagnostics including CLI version, Node.js version, current platform, workspace detection, package-manager hints, and local release-gate coverage.

## Usage

```text
Usage: a2amesh doctor [options]

Prints local CLI diagnostics including CLI version, Node.js version, current platform, workspace
detection, package-manager hints, and local release-gate coverage.

Options:
  --release-gates  Include local release gate commands and matching CI signals
  -h, --help       display help for command
```

## Examples

### Print diagnostics as JSON. (Linux/macOS)

```bash
a2amesh doctor --json --release-gates
```

### Print diagnostics as JSON. (PowerShell)

```powershell
a2amesh doctor --json --release-gates
```
